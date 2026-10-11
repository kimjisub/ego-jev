// The decision loop in which Jev picks the next action on an ego lite Page.
// The question design (decide), action resolution (resolve), loop (runGoal), check and read come from
// jev-browser 0.1.2 session.mjs (MIT, Ying-Kai Liao, see jev/LICENSE). Page reads and actions use the ego API.
//
// Differences from jev-browser
// - No Playwright and no MCP. Only the top document is read (no iframes) and network requests are not tracked
//   (settling watches DOM mutations only). No automatic new-tab switching and no highlight overlay.
// - actionError() maps ego error messages, not Playwright ones.
// - Checkboxes and labels are clicked at their left edge; a click blocked by a sticky header is retried after scrolling (clickOrLabel).
// - Before ending with done, Jev is asked again whether every part of the goal is in effect on the page (verify).
//   jev-browser ended on the first done score alone and once reported done with a filter left unchecked.
import { jev } from "./jev/jev.mjs";
import { ENUMERATE, EXTRACT_BLOCKS } from "./jev/page-script.mjs";
import { FIELDISH, SELECTISH, FILEISH, brief, pageDiff, repeatedElements } from "./jev/page-model.mjs";
import { normalizeBlocks, batchBlocks, batchQuestions, pickBlocks, readResult, totalChars, requestChars, MIN_PRUNE_CHARS, BUDGET_CHARS, DROP_BELOW, MAX_JEV_CALLS } from "./jev/prune.mjs";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const sel = i => `[data-jev-i="${i}"]`;

export const TOOLS = {
  click: "Click the target (link, button, checkbox, radio, tab, menu item)",
  type: "Type one of the given `values` into the target text field, replacing its content",
  press_enter: "Press Enter in the target field (e.g. to submit a search or add an item)",
  press_key: "Press a keyboard key other than Enter (Escape, Tab, arrow keys, Space, Backspace…)",
  select: "Choose an option in the target <select> dropdown",
  hover: "Move the mouse over the target to reveal hidden content",
  right_click: "Right-click the target to open a context menu",
  drag: "Drag the target and drop it onto another element",
  upload: "Attach one of the given `values` (a file path) to the target file input",
  scroll: "Scroll down to load or reveal more content",
  wait: "Wait: the page is still loading or processing (spinner, 'loading…', busy/disabled button)",
  none: "No action: the goal is already achieved, or nothing on this page can make progress",
};
export const KEYS = ["Escape", "Tab", "Space", "Backspace", "Delete", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "PageDown", "PageUp", "Home", "End"];
const TARGETED = new Set(["click", "type", "press_enter", "select", "hover", "right_click", "drag", "upload"]);
const GUARDED = new Set(["click", "press_enter", "press_key"]);
// Dialog policies: { type, message } -> accept? Alerts and "leave page?" carry no decision.
export const SAFE_DIALOGS = d => ["alert", "beforeunload"].includes(d.type);
export const ACCEPT_DIALOGS = () => true;

const MAX_SINGLE = 240;          // choice questions accept at most 255 options
const MAX_STATE_CHARS = 70_000;  // requests are capped at 32,768 input tokens
const GROUP = 30;
const VERIFY_DONE = 0.65, VERIFY_LIKELY = 0.35;
const REQUIRE_MET = 0.5;

// For questions that send the whole page (check, verify, ...). Pages with many elements exceed the input cap,
// so elements with state (checked, value, expanded) are kept first and the rest fill up to the cap, in page order.
// Size is measured with requestChars because CJK text costs more tokens per character.
const FIT_CHARS = 45_000;       // JSON costs more tokens per char than prose, so this sits below MAX_STATE_CHARS
const fits = x => requestChars(JSON.stringify(x)) <= FIT_CHARS;
export function fitPage(page) {
  if (fits(page)) return page;
  const stateful = e => e.checked === true || e.expanded === true || e.value !== undefined;
  const text = page.text.slice(0, 3000);
  const order = [...page.elements.filter(stateful), ...page.elements.filter(e => !stateful(e))];
  let lo = 0, hi = order.length;
  const build = n => { const keep = new Set(order.slice(0, n).map(e => e.i)); return { ...page, text, elements: page.elements.filter(e => keep.has(e.i)), elements_omitted: page.elements.length - keep.size }; };
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (fits(build(mid))) lo = mid; else hi = mid - 1; }
  return build(lo);
}

// Short, model-readable reason for a failed ego action.
export function actionError(e) {
  const msg = String(e?.message ?? e).replace(/^\w*Error:\s*/, "");
  if (/intercepts pointer events/i.test(msg)) return "click blocked: another element (a modal, overlay or banner) covers the target";
  if (/matched 0 elements|not attached|detached/i.test(msg)) return "target is no longer on the page (the page changed)";
  if (/zero-sized|not visible|hidden/i.test(msg)) return "target is not visible";
  if (/disabled|not enabled/i.test(msg)) return "target is disabled";
  return msg.split("\n")[0].slice(0, 160);
}

// true if the last `times * k` entries of seq are one k-long block repeated `times` times
export function repeatsBlock(seq, k, times) {
  if (seq.length < k * times) return false;
  const tail = seq.slice(-k * times), block = tail.slice(0, k).join("\n");
  if (k > 1 && new Set(tail.slice(0, k)).size === 1) return false;
  for (let n = 1; n < times; n++) if (tail.slice(n * k, (n + 1) * k).join("\n") !== block) return false;
  return true;
}

export class EgoJev {
  constructor(egoPage) {
    this.ep = egoPage;
    this.events = []; this.lastPage = null;
    this.dialogPolicy = SAFE_DIALOGS;
    this.stats = { calls: 0, jev_ms: 0, tokens: 0 };
  }

  // The page is settled when the DOM has not changed for `quiet` ms. The observer is installed on first use.
  async settle({ quiet = 400, max = 8000 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < max) {
      let idle = 0;
      try {
        idle = await this.ep.evaluate(() => {
          if (!window.__jevMO) {
            window.__jevMut = performance.now();
            window.__jevMO = new MutationObserver(recs => { if (recs.some(r => r.attributeName !== "data-jev-i")) window.__jevMut = performance.now(); });
            window.__jevMO.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
          }
          return document.readyState === "loading" ? 0 : performance.now() - window.__jevMut;
        });
      } catch { idle = 0; }
      if (idle >= quiet) break;
      await sleep(150);
    }
    return Date.now() - t0;
  }

  url() { return this.ep.url(); }
  title() { return this.ep.title().catch(() => ""); }

  async open(url) {
    const t0 = Date.now();
    await this.ep.goto(url);
    await this.settle();
    return { url: await this.url(), title: await this.title(), ms: Date.now() - t0 };
  }

  async snapshot() {
    const r = await this.ep.evaluate(ENUMERATE, { start: 0 });
    const s = { url: r.url, title: r.title ?? "", text: r.text ?? "", metrics: { ...r.metrics, elements: r.elements.length }, elements: r.elements };
    const rep = repeatedElements(r.elements); if (rep) s.repeated_elements = rep;
    if (r.dialogs?.length) s.dialogs = r.dialogs;
    this.lastPage = s;
    return s;
  }

  async call(state, questions) {
    const r = await jev(state, questions);
    this.stats.calls++; this.stats.jev_ms += r.ms; this.stats.tokens += r.tokens;
    return r;
  }

  // Yes/no question about the current page -> probability.
  async check(question) {
    await this.settle();
    const page = await this.snapshot();
    const { answers } = await this.call({ page: fitPage(page) }, { q: { type: "noul", instructions: `Answer about \`page\`: ${question}` } });
    return answers.q.noul;
  }

  async extractBlocks({ maxBlock, maxChars } = {}) {
    const r = await this.ep.evaluate(EXTRACT_BLOCKS, { maxBlock, maxChars });
    return { url: r.url, title: r.title ?? "", blocks: r.blocks, truncated: r.truncated };
  }

  // Page content relevant to `question`: code splits into blocks, Jev ranks them, code reassembles.
  async read(question, { budgetChars = BUDGET_CHARS, minChars = MIN_PRUNE_CHARS, dropBelow = DROP_BELOW, maxBlock, maxChars } = {}) {
    await this.settle();
    const { url, title, blocks: raw, truncated } = await this.extractBlocks({ maxBlock, maxChars });
    const blocks = normalizeBlocks(raw, maxBlock ? { maxBlock } : {});
    const size = totalChars(blocks);
    const base = { url, title, question, blocks, truncated };
    const gate = Math.max(minChars, budgetChars);
    if (size <= gate) {
      const { kept, dropped } = pickBlocks(blocks, {}, { dropBelow, budgetChars });
      return readResult({ ...base, kept, dropped, pruned: false, reason: `page text is ${size} chars, at or below the ${gate}-char threshold for ranking: no Jev call` });
    }
    const scores = {};
    let calls = 0, ms = 0;
    const batches = batchBlocks(blocks);
    for (const batch of batches.slice(0, MAX_JEV_CALLS)) {
      const state = { question, page: { url, title, blocks: batch.map(b => ({ i: b.i, ...(b.section ? { section: b.section } : {}), text: b.text })) } };
      try {
        const r = await this.call(state, batchQuestions(batch));
        calls++; ms += r.ms;
        for (const b of batch) { const a = r.answers[`b${b.i}`]; if (a?.noul !== undefined) scores[b.i] = a.noul; }
      } catch (e) {
        this.events.push(`read: a ranking request failed (${String(e?.message ?? e).slice(0, 80)}); its blocks were kept unranked`);
      }
    }
    const { kept, dropped } = pickBlocks(blocks, scores, { dropBelow, budgetChars });
    const unranked = blocks.length - Object.keys(scores).length;
    const capped = batches.length > MAX_JEV_CALLS ? ` (the page needs ${batches.length} ranking requests; only the first ${MAX_JEV_CALLS} were made)` : "";
    return readResult({
      ...base, kept, dropped, pruned: true, jevCalls: calls, jevMs: ms,
      reason: unranked ? `${unranked} of ${blocks.length} blocks could not be ranked and were kept unless over budget${capped}` : undefined,
    });
  }

  async decide(page, goal, values, history, lastChange, extra = {}) {
    const task = { goal, ...extra, ...(Object.keys(values).length ? { values } : {}), history, ...(lastChange ? { last_change: lastChange } : {}) };
    const withValues = Object.keys(values).length ? ", with the given `task.values`" : "";
    const common = {
      done: { type: "noul", instructions: `Does \`page\` show that \`task.goal\` has been achieved${withValues}? Judge from \`page.text\` and \`page.elements\`.` },
      done_change: { type: "noul", instructions: `Does \`page\` show that \`task.goal\` has been achieved${withValues}? Judge from \`page.text\`, \`page.elements\` and \`task.last_change\` (what the last action changed).` },
      blocked: { type: "noul", instructions: "Is there something on `page` that stops progress on `task.goal` and cannot be handled by clicking or typing (captcha, access denied, error page)?" },
      error: { type: "noul", instructions: "Does `page` show an error or rejection message (e.g. invalid credentials, a validation error, not found) caused by the actions in `task.history`?" },
      login: { type: "noul", instructions: "Is `page` a sign-in or sign-up screen, or asking the user to log in, before `task.goal` can continue?" },
      irreversible: { type: "noul", instructions: "Would the next action toward `task.goal` on `page` have an effect outside this browser that is hard to undo, such as placing an order, paying, sending a message, deleting data or publishing?" },
      tool: { type: "choice", instructions: "What is the next action toward `task.goal` on `page`, given what `task.history` already did?", criteria: TOOLS },
    };
    if (Object.keys(values).length) common.value = { type: "choice", instructions: "If the next action toward `task.goal` types, selects or uploads something, which of `task.values` should it use? Prefer values not yet entered on `page`.", criteria: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v).slice(0, 200)])) };
    const targetQ = { type: "choice", instructions: "Which entry of `page.elements` (by its `i`) should the next action toward `task.goal` act on?" };

    if (page.elements.length <= MAX_SINGLE && fits(page)) {
      targetQ.criteria = Object.fromEntries(page.elements.map(e => [String(e.i), null]));
      const r = await this.call({ page, task }, { ...common, ...(page.elements.length ? { target: targetQ } : {}) });
      return { ...r.answers, stages: 1 };
    }
    // Two stages: groups of consecutive elements, then elements in the likeliest groups.
    const groups = [];
    for (let k = 0; k < page.elements.length; k += GROUP) {
      const els = page.elements.slice(k, k + GROUP);
      groups.push({ g: groups.length, summary: els.map(e => (e.label || e.text || e.placeholder || e.href || e.tag).slice(0, 24)).join(" | ").slice(0, 700) });
    }
    const lite = { url: page.url, title: page.title, text: page.text, metrics: page.metrics, dialogs: page.dialogs, groups };
    const r1 = await this.call({ page: lite, task }, {
      ...common,
      group: { type: "choice", instructions: "Which entry of `page.groups` (by its `g`) contains the element the next action toward `task.goal` should act on? Each group summarises consecutive page elements.", criteria: Object.fromEntries(groups.map(g => [String(g.g), null])) },
    });
    const ranked = Object.entries(r1.answers.group.probabilities).sort((a, b) => b[1] - a[1]);
    const pick = []; let mass = 0;
    for (const [g, p] of ranked) { if (pick.length && (mass >= 0.9 || pick.length >= 4)) break; pick.push(+g); mass += p; }
    const sub = page.elements.filter(e => pick.includes(Math.floor(e.i / GROUP))).slice(0, MAX_SINGLE);
    const r2 = await this.call({ page: { url: page.url, title: page.title, text: page.text.slice(0, 1200), elements: sub }, task }, {
      target: { ...targetQ, criteria: Object.fromEntries(sub.map(e => [String(e.i), null])) },
    });
    return { ...r1.answers, target: r2.answers.target, stages: 2, groups_considered: pick };
  }

  // Resolve independent tool/target/value answers into one consistent action.
  resolve(page, a, values) {
    let tool = a.tool.choice;
    const byI = new Map(page.elements.map(e => [String(e.i), e]));
    const ranked = a.target ? Object.entries(a.target.probabilities).sort((x, y) => y[1] - x[1]) : [];
    const fits = { type: FIELDISH, press_enter: e => FIELDISH(e) || e.tag.startsWith("input"), select: SELECTISH, upload: FILEISH };
    let [ti, tp] = ranked[0] ?? [null, 0];
    if (fits[tool] && ti != null && !fits[tool](byI.get(ti))) {
      const alt = ranked.find(([i]) => fits[tool](byI.get(i)));
      if (alt && (alt[1] >= 0.1 || tool === "upload")) [ti, tp] = alt;
      else if (tool === "upload") { const f = page.elements.find(FILEISH); if (f) [ti, tp] = [String(f.i), 0.5]; }
      else if (tool === "type" || tool === "select") tool = "click";
    }
    if (tool === "type" && !Object.keys(values).length) tool = "click";
    const valueKey = a.value?.choice;
    return {
      tool, p_tool: a.tool.probabilities[a.tool.choice], target: ti == null ? null : +ti, p_target: tp ?? 0, el: byI.get(ti),
      valueKey, value: valueKey != null ? values[valueKey] : undefined,
      candidates: ranked.slice(0, 3).map(([i, p]) => ({ i: +i, p: +p.toFixed(2), el: brief(byI.get(i)) })),
    };
  }

  // ego returns a receipt per action; a synchronous dialog that opened is reported in receipt.dialog.
  async handleReceipt(r) {
    const d = r?.dialog;
    if (!d) return;
    const dialog = { type: d.type ?? d.dialogType ?? "confirm", message: String(d.message ?? d.text ?? "") };
    const accept = await Promise.resolve(this.dialogPolicy(dialog)).catch(() => false);
    this.events.push(`${dialog.type} dialog "${dialog.message.slice(0, 100)}" ${accept ? "accepted" : "dismissed"}`);
    await (accept ? this.ep.acceptDialog(this.promptText ?? undefined) : this.ep.dismissDialog()).catch(() => {});
  }

  // Checkboxes and radios (or their labels) are clicked at the label's left edge. Labels often hold a link in the
  // middle (a glossary popup, say), so a centre click opens it instead of toggling. Hidden 0x0 inputs reach their label this way.
  // Other elements are clicked as is; if a sticky header intercepts the click, scroll the target to the centre and retry once.
  // A real modal still blocks the retry, so the original error goes back to Jev.
  async clickOrLabel(s, opts) {
    const box = await this.ep.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const isToggle = el.tagName === "INPUT" && /^(checkbox|radio)$/.test(el.type);
      const l = el.tagName === "LABEL" ? el
        : isToggle ? (el.closest("label") || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`))) : null;
      if (!l) return null;
      l.scrollIntoView({ block: "center", inline: "nearest" });
      l.setAttribute("data-jev-label", "1");
      return { h: l.getBoundingClientRect().height };
    }, s);
    const clear = () => this.ep.evaluate(() => document.querySelectorAll("[data-jev-label]").forEach(l => l.removeAttribute("data-jev-label")));
    if (box) {
      try { return await this.ep.click("[data-jev-label]", { ...opts, position: { x: 4, y: Math.max(1, Math.floor(box.h / 2)) } }); }
      finally { await clear(); }
    }
    try { return await this.ep.click(s, { ...opts, timeout: 1500 }); }
    catch (e) {
      if (!/intercepts pointer events/i.test(String(e))) throw e;
      await this.ep.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: "center", inline: "center" }), s);
      try { return await this.ep.click(s, { ...opts, timeout: 1500 }); } catch {}
      // still covered: an open autocomplete list or popover usually closes on Escape
      await this.ep.keyboard.press("Escape"); await sleep(200);
      try { return await this.ep.click(s, opts); } catch { throw e; }
    }
  }

  // act = { tool, target?, value?, key?, destination? }
  async act(act) {
    const t = Date.now();
    const needs = TARGETED.has(act.tool) || (act.tool === "press_key" && act.target != null);
    if (needs && act.target == null) throw new Error(`${act.tool} needs a target element`);
    const s = act.target != null ? sel(act.target) : null;
    const label = text => ({ label: `jev: ${text}`.slice(0, 40) });
    let r;
    switch (act.tool) {
      case "click": r = await this.clickOrLabel(s, label("click")); break;
      case "right_click": r = await this.ep.click(s, { button: "right", ...label("right click") }); break;
      case "type": {
        if (act.value == null) throw new Error("no value to type");
        r = await this.ep.fill(s, String(act.value));
        break;
      }
      case "press_enter": r = await this.ep.press(s, "Enter"); break;
      case "press_key": {
        const key = act.key ?? "Escape";
        r = s ? await this.ep.press(s, key) : await this.ep.keyboard.press(key);
        break;
      }
      case "select": {
        const v = String(act.value ?? "");
        r = await this.ep.selectOption(s, { label: v }).catch(() => this.ep.selectOption(s, v));
        break;
      }
      case "hover": r = await this.ep.hover(s, label("hover")); break;
      case "drag": {
        if (act.destination == null) throw new Error("drag needs a destination element");
        r = await this.ep.dragAndDrop(s, sel(act.destination), label("drag"));
        break;
      }
      case "upload": {
        if (act.value == null) throw new Error("no file path to upload");
        r = await this.ep.setInputFiles(s, [String(act.value)]);
        break;
      }
      case "scroll": await this.ep.mouse.move(640, 400); await this.ep.mouse.wheel(0, 700, label("scroll")); break;
      case "wait": await sleep(1000); break;
      case "back": await this.ep.evaluate(() => history.back()); break;
      case "none": break;
      default: throw new Error(`unknown action ${act.tool}`);
    }
    await this.handleReceipt(r);
    return Date.now() - t;
  }

  // Work toward one goal.
  // status: done | likely_done (verify) | needs_confirmation | needs_login | error | blocked | stuck | ambiguous | max_actions
  async do(goal, opts = {}) {
    const { allowIrreversible = false, irreversibleAt = 0.6 } = opts;
    this.heldDialog = null;
    this.dialogPolicy = allowIrreversible ? ACCEPT_DIALOGS : this.dialogGuard(goal, irreversibleAt);
    try { return await this.runGoal(goal, opts); }
    finally { this.dialogPolicy = SAFE_DIALOGS; }
  }

  // confirm/prompt during do(): accept unless Jev thinks accepting is hard to undo.
  dialogGuard(goal, irreversibleAt) {
    return async d => {
      if (SAFE_DIALOGS(d)) return true;
      let p = 1;
      try {
        const { answers } = await this.call({ task: { goal }, dialog: { type: d.type, message: d.message.slice(0, 500) } }, { q: { type: "noul", instructions: "Would accepting `dialog` have an effect outside this browser that is hard to undo, such as placing an order, paying, sending a message, deleting data or publishing?" } });
        p = answers.q.noul;
      } catch {}
      if (p < irreversibleAt) return true;
      this.heldDialog = { message: d.message.slice(0, 200), p_irreversible: +p.toFixed(2) };
      return false;
    };
  }

  // Check before finishing: the first done score is also high when the page merely looks close to the goal. Ask
  // separately whether every part of the goal is in effect now, judged from page state rather than the action history.
  async verify(page, goal, history) {
    const { answers } = await this.call({ page: fitPage(page), task: { goal, history: history.slice(-12) } }, {
      all: { type: "noul", instructions: "Look only at the current state of `page` (selected filters, checked boxes, chosen sort order, entered values, shown results), not at what `task.history` says was clicked. Is every part of `task.goal` visibly in effect on `page` right now? If any requested part is not visibly in effect, the answer is no." },
    });
    return answers.all.noul;
  }

  // Score each caller-given requirement against the current page state, in one request.
  async requirements(page, goal, require) {
    const qs = Object.fromEntries(require.map((text, k) => [`r${k}`, { type: "noul", instructions: `Look only at the current state of \`page\` (selected filters, checked boxes, chosen sort order, entered values, the screen that is shown). Is this requirement visibly in effect on \`page\` right now: "${text}"? If it is not visibly in effect, the answer is no.` }]));
    const { answers } = await this.call({ page: fitPage(page), task: { goal } }, qs);
    return require.map((_, k) => answers[`r${k}`].noul);
  }

  async runGoal(goal, { values = {}, require = [], maxActions = 10, doneAt = 0.5, minTarget = 0.3, allowIrreversible = false, irreversibleAt = 0.6, log = () => {} } = {}) {
    const t0 = Date.now(); const calls0 = this.stats.calls;
    const history = []; const rounds = [];
    let prevPage = null, waits = 0, page = null, status = "max_actions", info, pending, retried = false, rejected = 0;
    const seen = new Map(), reached = new Set();
    this.promptText = values.prompt;
    // Confirm a done candidate with verify(). Returns true to end the loop.
    const finish = async (r, act) => {
      const v = await this.verify(page, goal, history);
      r.verify = +v.toFixed(2);
      log(`     verify=${r.verify}`);
      if (v >= VERIFY_DONE) { status = "done"; return true; }
      if (v >= VERIFY_LIKELY) { status = "likely_done"; info = "Jev is unsure every part of the goal is in effect; verify with a check, snapshot or screenshot"; return true; }
      rejected++;
      if (act.tool === "none" || rejected >= 2) { status = "stuck"; info = "Jev stopped acting, but the page does not show every part of the goal in effect; check the page"; return true; }
      return false;
    };
    for (let round = 0; round <= maxActions; round++) {
      await this.settle();
      page = await this.snapshot();
      if (this.events.length) history.push(...this.events.splice(0).map(e => ({ event: e })));
      // With requirements, the round works on the first one never reached yet. A reached one stays reached, because
      // later steps can undo earlier states (a cart empties once the order is placed). The run ends when all have
      // been reached and the last is in effect now; done if every one is still in effect, likely_done otherwise.
      let focus = goal, extra = {}, req;
      if (require.length) {
        req = (await this.requirements(page, goal, require)).map(p => +p.toFixed(2));
        req.forEach((p, k) => { if (p >= REQUIRE_MET) reached.add(k); });
        log(`  r${round}: require=[${req.join(", ")}]`);
        const last = require.length - 1;
        let next = require.findIndex((_, k) => !reached.has(k));
        if (next < 0 && req[last] >= REQUIRE_MET) {
          rounds.push({ round, require: req });
          const gone = require.filter((_, k) => req[k] < REQUIRE_MET);
          if (gone.length) { status = "likely_done"; info = `every requirement was reached, but these are not in effect now: ${gone.map(t => `"${t}"`).join(", ")}`; }
          else status = "done";
          break;
        }
        if (next < 0) next = last;
        focus = require[next];
        extra = { overall_goal: goal, already_reached: require.filter((_, k) => reached.has(k)) };
      }
      const a = await this.decide(page, focus, values, history.slice(-12), round ? pageDiff(prevPage, page) : undefined, extra);
      prevPage = page;
      const act = this.resolve(page, a, values);
      const done = Math.max(a.done.noul, a.done_change?.noul ?? 0);
      const r = {
        round, done: +done.toFixed(2), done_plain: +a.done.noul.toFixed(2), done_change: +(a.done_change?.noul ?? 0).toFixed(2),
        blocked: +a.blocked.noul.toFixed(2), error_shown: +a.error.noul.toFixed(2), login: +a.login.noul.toFixed(2), irreversible: +a.irreversible.noul.toFixed(2),
        tool: act.tool, p_tool: +act.p_tool.toFixed(2), target: act.target, p_target: +act.p_target.toFixed(2), el: brief(act.el),
        value: act.valueKey, elements: page.elements.length, stages: a.stages, candidates: act.candidates,
        ...(req ? { require: req, focus } : {}),
      };
      rounds.push(r);
      log(`  r${round}: ${act.tool}(${r.p_tool}) -> #${act.target} ${r.el} (${r.p_target})${act.valueKey ? ` value=${act.valueKey}` : ""}  done=${r.done} err=${r.error_shown} login=${r.login} irrev=${r.irreversible}  [${page.elements.length} els${a.stages === 2 ? ", 2-stage" : ""}]`);

      // With requirements, Jev's own done score is about the focused one only; the requirement scores decide when to stop.
      if (!req && round > 0 && done >= doneAt && done < 0.85 && act.tool !== "none") {
        // "done" and "next action" disagree: settle it with a stricter single question
        const c = await this.call({ page: fitPage(page), task: { goal, history: history.slice(-12) } }, { complete: { type: "noul", instructions: "Is everything `task.goal` asks for already finished on `page`, so that no further action (such as pressing a submit, search or continue button) is needed?" } });
        r.confirm = +c.answers.complete.noul.toFixed(2);
        log(`     confirm=${r.confirm}`);
        if (r.confirm >= 0.45 && await finish(r, act)) break;
        if (status === "max_actions" && !allowIrreversible && a.irreversible.noul >= irreversibleAt && GUARDED.has(act.tool)) {
          status = "done"; info = "stopped before an action that looks irreversible and may go beyond this goal";
          pending = { action: act.tool, element: brief(act.el), p_irreversible: r.irreversible };
          break;
        }
      } else if (!req && done >= (round > 0 ? doneAt : 0.9) && (done >= 0.85 || act.tool === "none" || round === 0)) {
        if (await finish(r, act)) break;
      }
      if (round === maxActions) break;
      if (a.login.noul >= 0.7 && !Object.keys(values).length) {
        status = "needs_login"; info = "the page wants a sign-in and no values were given; log in in ego (handOff) or pass credentials in values"; break;
      }
      if (round > 0 && a.error.noul >= 0.7) { status = "error"; info = "the page shows an error after the last action"; break; }
      if (act.tool === "none" && round === 0 && !retried) {
        // content that appears after a delay (modals, late renders): look once more before giving up
        retried = true; await sleep(1500); round--; rounds.pop(); continue;
      }
      if (!req && act.tool === "none" && round > 0 && done >= 0.35 && a.error.noul < 0.5 && a.blocked.noul < 0.5) {
        if (await finish(r, act)) break;
      }
      if (act.tool === "none") { status = a.blocked.noul >= 0.5 ? "blocked" : "stuck"; if (req) info = `Jev found no action for the requirement "${focus}"`; break; }
      if (a.blocked.noul >= 0.85) { status = "blocked"; break; }
      if (act.tool === "wait") {
        if (++waits > 6) { status = "stuck"; info = "page never finished loading"; break; }
        await this.settle({ max: 4000 }); await sleep(600); history.push({ action: "wait" }); continue;
      }
      if (TARGETED.has(act.tool) && act.p_target < minTarget) { status = "ambiguous"; info = "target confidence too low; refine the goal or act on a candidate directly"; break; }
      const seenKey = `${act.tool}|${brief(act.el)}|${["type", "select", "upload"].includes(act.tool) ? act.valueKey : ""}|${page.url}|${page.text}|${JSON.stringify(page.elements)}`;
      seen.set(seenKey, (seen.get(seenKey) ?? 0) + 1);
      if (seen.get(seenKey) >= 3) { status = "stuck"; info = "repeating the same action on the same page without progress"; break; }
      const seq = [...history.filter(h => h.action).map(h => `${h.action}|${h.element}|${h.value ?? ""}`), `${act.tool}|${brief(act.el)}|${["type", "select", "upload"].includes(act.tool) ? act.valueKey ?? "" : ""}`];
      if (repeatsBlock(seq, 2, 3) || repeatsBlock(seq, 3, 3) || repeatsBlock(seq, 1, 8)) { status = "stuck"; info = "repeating the same sequence of actions; the goal may already be done, check the page"; break; }

      // follow-up questions only for the chosen action
      if (act.tool === "select" && act.value == null && act.el?.options?.length) {
        const { answers } = await this.call({ page: fitPage(page), task: { goal }, dropdown: act.el }, { opt: { type: "choice", instructions: "Which option of `dropdown.options` should be chosen for `task.goal`?", criteria: Object.fromEntries(act.el.options.map(o => [o, null])) } });
        act.value = answers.opt.choice; act.valueKey = undefined;
      }
      if (act.tool === "press_key") {
        const { answers } = await this.call({ page: { url: page.url, title: page.title, text: page.text, dialogs: page.dialogs }, task: { goal, history: history.slice(-6) } }, { key: { type: "choice", instructions: "Which keyboard key should be pressed next for `task.goal`?", criteria: Object.fromEntries(KEYS.map(k => [k, null])) } });
        act.key = answers.key.choice;
        const tgt = act.el; if (!tgt || !(FIELDISH(tgt) || tgt.tag.startsWith("input"))) act.target = null;
      }
      if (act.tool === "drag") {
        const others = page.elements.filter(e => e.i !== act.target).slice(0, MAX_SINGLE);
        if (!others.length) { status = "stuck"; info = "nothing on the page to drop onto"; break; }
        const { answers } = await this.call({ page: { ...page, elements: others }, task: { goal, dragging: brief(act.el) } }, { dest: { type: "choice", instructions: "Onto which entry of `page.elements` (by its `i`) should `task.dragging` be dropped for `task.goal`?", criteria: Object.fromEntries(others.map(e => [String(e.i), null])) } });
        act.destination = +answers.dest.choice;
        r.destination = brief(page.elements.find(e => e.i === act.destination));
      }
      if (GUARDED.has(act.tool) && !allowIrreversible && a.irreversible.noul >= irreversibleAt) {
        status = "needs_confirmation"; info = "the next action looks hard to undo; call again with --allow-irreversible to proceed";
        pending = { action: act.tool, element: brief(act.el), ...(act.key ? { key: act.key } : {}), p_irreversible: r.irreversible };
        break;
      }

      const h = { action: act.tool, element: brief(act.el) };
      if (act.tool === "select" && act.value != null) h.option = act.value;
      if (act.valueKey && ["type", "select", "upload"].includes(act.tool)) h.value = act.valueKey;
      if (act.key) h.key = act.key;
      if (r.destination) h.destination = r.destination;
      try { r.act_ms = await this.act(act); }
      catch (e) { h.error = actionError(e); r.error = h.error; log(`  ! ${h.error}`); }
      history.push(h);
      if (this.heldDialog) {
        status = "needs_confirmation"; info = "the action opened a confirmation dialog that looks hard to undo, so it was dismissed; call again with --allow-irreversible to accept it";
        pending = { action: h.action, element: h.element, dialog: this.heldDialog.message, p_irreversible: this.heldDialog.p_irreversible };
        break;
      }
    }
    if (this.events.length) history.push(...this.events.splice(0).map(e => ({ event: e })));
    const out = { status, goal, url: await this.url().catch(() => page?.url), title: await this.title(), actions: history, rounds, jev_calls: this.stats.calls - calls0, ms: Date.now() - t0 };
    if (info) out.info = info;
    if (pending) out.pending = pending;
    out.done_score = +(rounds.at(-1)?.done ?? 0);
    if (rounds.at(-1)?.verify != null) out.verify_score = rounds.at(-1).verify;
    const lastReq = rounds.findLast(r => r.require)?.require;
    if (lastReq) out.requirements = require.map((text, k) => ({ text, p: lastReq[k] }));
    if (!["done", "likely_done"].includes(status)) {
      out.page_text = page?.text?.slice(0, 600);
      if (["ambiguous", "stuck", "max_actions"].includes(status)) out.candidates = rounds.at(-1)?.candidates;
    }
    return out;
  }
}
