// Runs inside `ego-browser nodejs`. The short script written by the ego-jev CLI passes the arguments (EGO_JEV_ARGS)
// and ego's global functions (EGO_JEV_EGO), then imports this file. The API key is read once from a FIFO
// and handed to the Jev client directly: process.env is shared by every script in the runtime process.
import { readFileSync } from "node:fs";
import { EgoJev } from "./ego-jev.mjs";
import { setApiKey, setProxy } from "./jev/jev.mjs";

const A = globalThis.EGO_JEV_ARGS;
const { taskSpace } = globalThis.EGO_JEV_EGO;
if (A.proxy) setProxy(A.proxy);
else setApiKey(readFileSync(A.keyFifo, "utf8").trim());

const task = A.space != null ? await taskSpace(Number(A.space)) : await taskSpace(A.name ?? "ego-jev");
const page = task.page(A.page ?? "p1");
const b = new EgoJev(page);
if (A.url) await b.open(A.url); else await b.settle();

let out;
if (A.cmd === "do") {
  const r = await b.do(A.goal, { values: A.values ?? {}, require: A.require ?? [], batchFill: A.batchFill !== false, mergeRequire: A.mergeRequire !== false, maxActions: A.max ?? 10, allowIrreversible: !!A.allowIrreversible, log: line => console.log(line) });
  const { rounds, ...rest } = r;
  out = rest;
} else if (A.cmd === "check") {
  out = { question: A.goal, p: await b.check(A.goal), jev_calls: b.stats.calls };
} else if (A.cmd === "read") {
  const r = await b.read(A.goal);
  out = { url: r.url, title: r.title, text: r.text ?? r.content, jev_calls: r.jev_calls ?? r.jevCalls };
}
if (b.events.length) out.events = b.events;
out.space = task.spaceId; out.page = page.label;
if (A.finish) { await task.finish({ keep: [] }); out.finished = true; }
console.log("EGO_JEV_RESULT " + JSON.stringify(out));
