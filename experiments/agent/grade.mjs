#!/usr/bin/env node
// Grades one agent run and appends it to experiments/agent/results/<tag>.jsonl.
//
//   node experiments/agent/grade.mjs reset <task>          clear the site's storage before a run
//   node experiments/agent/grade.mjs record <tag> <task> <mode> <rep> <space> <duration_ms> <tokens> <tool_uses> [answer]
//
// `record` runs the task's check in page p1 of the TaskSpace the agent left open, grades the answer, closes the
// TaskSpace and appends one JSON line.
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_TASKS } from "./tasks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EGO = process.env.EGO_BROWSER ?? join(homedir(), ".local", "bin", "ego-browser");

const ego = script => new Promise(res => {
  const p = spawn(EGO, ["nodejs"], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", d => out += d); p.stderr.on("data", d => out += d);
  p.on("close", () => res(out));
  p.stdin.end(script);
});

const [cmd, ...a] = process.argv.slice(2);
if (cmd === "reset") {
  const url = AGENT_TASKS[a[0]].reset;
  if (!url) { console.log("no reset"); process.exit(0); }
  const out = await ego(`
const t = await taskSpace("ego-jev-agent-reset");
const p = t.page("p1");
await p.goto(${JSON.stringify(url)}, { waitUntil: "domcontentloaded" });
await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); for (const c of document.cookie.split(";")) { const n = c.split("=")[0].trim(); if (n) document.cookie = n + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/"; } });
await t.finish({ keep: [] });
console.log("RESET_OK");`);
  console.log(out.includes("RESET_OK") ? "reset ok" : `reset failed: ${out.slice(-300)}`);
} else if (cmd === "record") {
  const [tag, task, mode, rep, space, duration, tokens, tools, ...ans] = a;
  const answer = ans.join(" ");
  const T = AGENT_TASKS[task];
  const out = await ego(`
const t = await taskSpace(${Number(space)});
const p = t.page("p1");
let res;
try { res = await p.evaluate(${T.check.toString()}); } catch (e) { res = { ok: false, error: String(e).slice(0, 200) }; }
await t.finish({ keep: [] });
console.log("CHECK " + JSON.stringify(res));`);
  const line = out.split("\n").find(l => l.startsWith("CHECK "));
  const check = line ? JSON.parse(line.slice(6)) : { ok: false, error: out.slice(-300) };
  const answerOk = T.answer ? T.answer(answer) : null;
  const row = { tag, task, mode, rep: Number(rep), ok: !!check.ok && answerOk !== false, check, answer, answer_ok: answerOk,
    duration_ms: Number(duration), tokens: Number(tokens), tool_uses: Number(tools) };
  mkdirSync(join(HERE, "results"), { recursive: true });
  appendFileSync(join(HERE, "results", `${tag}.jsonl`), JSON.stringify(row) + "\n");
  console.log(`${task} ${mode} rep${rep}: ${row.ok ? "OK" : "FAIL"} ${(row.duration_ms / 1000).toFixed(1)}s tokens=${row.tokens} tools=${row.tool_uses} ${JSON.stringify(check).slice(0, 160)}`);
} else {
  console.error("usage: grade.mjs reset <task> | record <tag> <task> <mode> <rep> <space> <duration_ms> <tokens> <tool_uses> [answer]");
  process.exit(2);
}
