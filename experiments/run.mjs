#!/usr/bin/env node
// Runs experiment tasks through the ego-jev CLI and records outcome, correctness, actions, Jev calls and time.
//
//   node experiments/run.mjs --tag NAME [--tasks a,b] [--modes procedure,outcome,require] [--repeat N] [-- extra ego-jev args]
//
// Needs TYPESAFE_API_KEY in the environment (for example under `op run`). Each run gets its own TaskSpace, which
// is checked with the task's `check` function and then closed. Results are appended to experiments/results/NAME.jsonl.
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TASKS } from "./tasks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "bin", "ego-jev.mjs");
const EGO = process.env.EGO_BROWSER ?? join(homedir(), ".local", "bin", "ego-browser");

const argv = process.argv.slice(2);
const opt = { tasks: Object.keys(TASKS), modes: ["procedure", "outcome", "require"], repeat: 1, extra: [] };
for (let k = 0; k < argv.length; k++) {
  const a = argv[k];
  if (a === "--tag") opt.tag = argv[++k];
  else if (a === "--tasks") opt.tasks = argv[++k].split(",");
  else if (a === "--modes") opt.modes = argv[++k].split(",");
  else if (a === "--repeat") opt.repeat = Number(argv[++k]);
  else if (a === "--") { opt.extra = argv.slice(k + 1); break; }
  else throw new Error(`unknown argument ${a}`);
}
if (!opt.tag) throw new Error("--tag is required");
if (!process.env.TYPESAFE_API_KEY) throw new Error("TYPESAFE_API_KEY is not set");
const OUT = join(HERE, "results", `${opt.tag}.jsonl`);
mkdirSync(dirname(OUT), { recursive: true });

function run(cmd, args, input) {
  return new Promise(res => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", d => out += d); p.stderr.on("data", d => err += d);
    // the ego runtime prints console.log to stderr when piped, so callers search both streams
    p.on("close", code => res({ code, out: out + "\n" + err, err }));
    if (input != null) p.stdin.end(input); else p.stdin.end();
  });
}

// ego scripts never contain the API key; they only reset site state and check pages.
const ego = script => run(EGO, ["nodejs"], script);

async function reset(url) {
  const r = await ego(`
const t = await taskSpace("ego-jev-exp-reset");
const p = t.page("p1");
await p.goto(${JSON.stringify(url)});
await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); for (const c of document.cookie.split(";")) { const n = c.split("=")[0].trim(); if (n) document.cookie = n + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/"; } });
await t.finish({ keep: [] });
console.log("RESET_OK");`);
  if (!r.out.includes("RESET_OK")) throw new Error(`reset failed: ${r.err || r.out}`);
}

async function check(space, fn) {
  const r = await ego(`
const t = await taskSpace(${Number(space)});
const p = t.page("p1");
let res;
try { res = await p.evaluate(${fn.toString()}); } catch (e) { res = { ok: false, error: String(e).slice(0, 200) }; }
await t.finish({ keep: [] });
console.log("CHECK " + JSON.stringify(res));`);
  const line = r.out.split("\n").find(l => l.startsWith("CHECK "));
  return line ? JSON.parse(line.slice(6)) : { ok: false, error: (r.err || r.out).slice(0, 300) };
}

const rows = [];
for (let rep = 0; rep < opt.repeat; rep++) {
  for (const name of opt.tasks) {
    const task = TASKS[name];
    for (const mode of opt.modes) {
      if (task.reset) await reset(task.reset);
      const goal = mode === "require" ? task.goals.outcome : task.goals[mode];
      const args = [CLI, "do", goal, ...Object.entries(task.values).map(([k, v]) => `${k}=${v}`),
        "--url", task.url, "--max", String(task.max), "--name", `ego-jev-exp-${name}-${mode}`];
      if (task.irreversible) args.push("--allow-irreversible");
      if (mode === "require") for (const q of task.require) args.push("--require", q);
      args.push(...opt.extra);
      const t0 = Date.now();
      const r = await run(process.execPath, args);
      const wall = Date.now() - t0;
      const line = r.out.split("\n").find(l => l.startsWith("EGO_JEV_RESULT "));
      const res = line ? JSON.parse(line.slice(15)) : null;
      const verdict = res?.space != null ? await check(res.space, task.check) : { ok: false, error: (r.err || r.out).slice(-300) };
      const row = {
        tag: opt.tag, task: name, mode, rep, status: res?.status ?? "crash", ok: !!verdict.ok,
        actions: res?.actions?.filter(a => a.action).length ?? null, jev_calls: res?.jev_calls ?? null,
        loop_ms: res?.ms ?? null, wall_ms: wall, check: verdict, info: res?.info, extra: opt.extra.join(" "),
        jev_tokens: res?.jev_tokens ?? null,
        log: r.out.split("\n").filter(l => /^\s+r\d+:|^\s+!|verify=|confirm=|also typed/.test(l)).slice(0, 80),
      };
      appendFileSync(OUT, JSON.stringify(row) + "\n");
      rows.push(row);
      console.log(`${name.padEnd(10)} ${mode.padEnd(9)} ${row.ok ? "OK  " : "FAIL"} ${row.status.padEnd(18)} actions=${String(row.actions).padStart(2)} jev=${String(row.jev_calls).padStart(3)} wall=${(wall / 1000).toFixed(1)}s`);
    }
  }
}
const okN = rows.filter(r => r.ok).length;
console.log(`\n${okN}/${rows.length} correct, results in ${OUT}`);
