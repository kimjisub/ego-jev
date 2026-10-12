#!/usr/bin/env node
// Summarises agent comparison runs: per task and mode, correct runs, median and mean time, mean tool calls.
//
//   node experiments/agent/summarize.mjs TAG [TAG ...]
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const tags = process.argv.slice(2);
const rows = tags.flatMap(t => readFileSync(join(HERE, "results", `${t}.jsonl`), "utf8").trim().split("\n").map(l => JSON.parse(l)));
const med = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const s1 = ms => (ms / 1000).toFixed(1);

const tasks = [...new Set(rows.map(r => r.task))];
const modes = [...new Set(rows.map(r => r.mode))];
console.log(`| Task | ${modes.map(m => `${m}: correct | ${m}: median s | ${m}: mean s | ${m}: tools`).join(" | ")} |`);
console.log(`|---|${modes.map(() => "---|---|---|---").join("|")}|`);
const tot = Object.fromEntries(modes.map(m => [m, []]));
for (const t of tasks) {
  const cells = modes.map(m => {
    const rs = rows.filter(r => r.task === t && r.mode === m);
    if (!rs.length) return "| | |";
    tot[m].push(...rs);
    const d = rs.map(r => r.duration_ms);
    return `${rs.filter(r => r.ok).length}/${rs.length} | ${s1(med(d))} | ${s1(mean(d))} | ${mean(rs.map(r => r.tool_uses)).toFixed(1)}`;
  });
  console.log(`| ${t} | ${cells.join(" | ")} |`);
}
console.log(`| all | ${modes.map(m => { const rs = tot[m]; return rs.length ? `${rs.filter(r => r.ok).length}/${rs.length} | ${s1(med(rs.map(r => r.duration_ms)))} | ${s1(mean(rs.map(r => r.duration_ms)))} | ${mean(rs.map(r => r.tool_uses)).toFixed(1)}` : "| | |"; }).join(" | ")} |`);
