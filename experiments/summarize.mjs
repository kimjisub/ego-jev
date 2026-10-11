#!/usr/bin/env node
// Summarise experiment results as Markdown tables.
//
//   node experiments/summarize.mjs base opt        # tags = files in experiments/results/<tag>.jsonl
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const tags = process.argv.slice(2);
const rows = tags.flatMap(t => readFileSync(join(HERE, "results", `${t}.jsonl`), "utf8").trim().split("\n").map(l => JSON.parse(l)));

const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const f1 = x => Number.isFinite(x) ? x.toFixed(1) : "-";
const f0 = x => Number.isFinite(x) ? Math.round(x).toLocaleString("en-US") : "-";
const pct = (n, d) => d ? `${n}/${d}` : "-";

function stats(rs) {
  const ok = rs.filter(r => r.ok);
  return {
    n: rs.length,
    correct: ok.length,
    // claimed done but the check failed: the error that costs a caller the most
    falseDone: rs.filter(r => r.status === "done" && !r.ok).length,
    // correct, but the status asks the caller to look again
    unsureOk: rs.filter(r => r.ok && r.status !== "done").length,
    wall: mean(rs.map(r => r.wall_ms / 1000)),
    calls: mean(rs.map(r => r.jev_calls).filter(x => x != null)),
    tokens: mean(rs.map(r => r.jev_tokens).filter(x => x != null)),
    actions: mean(rs.map(r => r.actions).filter(x => x != null)),
  };
}

const groupBy = (rs, key) => rs.reduce((m, r) => (m[key(r)] ??= []).push(r) && m, {});

console.log("### By configuration and phrasing\n");
console.log("| Config | Phrasing | Correct | Claimed done but wrong | Correct but not `done` | Mean time | Mean Jev calls | Mean Jev tokens | Mean actions |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const [k, rs] of Object.entries(groupBy(rows, r => `${r.tag}|${r.mode}`))) {
  const [tag, mode] = k.split("|"), s = stats(rs);
  console.log(`| ${tag} | ${mode} | ${pct(s.correct, s.n)} | ${s.falseDone} | ${s.unsureOk} | ${f1(s.wall)} s | ${f1(s.calls)} | ${f0(s.tokens)} | ${f1(s.actions)} |`);
}

console.log("\n### By task (all phrasings)\n");
console.log(`| Task | ${tags.map(t => `${t}: correct`).join(" | ")} | ${tags.map(t => `${t}: time`).join(" | ")} | ${tags.map(t => `${t}: Jev calls`).join(" | ")} |`);
console.log(`|---|${tags.map(() => "---|").join("").repeat(3)}`);
for (const [task, rs] of Object.entries(groupBy(rows, r => r.task))) {
  const by = groupBy(rs, r => r.tag), s = Object.fromEntries(tags.map(t => [t, stats(by[t] ?? [])]));
  console.log(`| ${task} | ${tags.map(t => pct(s[t].correct, s[t].n)).join(" | ")} | ${tags.map(t => `${f1(s[t].wall)} s`).join(" | ")} | ${tags.map(t => f1(s[t].calls)).join(" | ")} |`);
}

console.log("\n### Every run\n");
console.log("| Config | Task | Phrasing | Rep | Status | Correct | Actions | Jev calls | Time |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.tag} | ${r.task} | ${r.mode} | ${r.rep} | ${r.status} | ${r.ok ? "yes" : "no"} | ${r.actions ?? "-"} | ${r.jev_calls ?? "-"} | ${f1(r.wall_ms / 1000)} s |`);
