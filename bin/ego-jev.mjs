#!/usr/bin/env node
// ego-jev: let Jev pick the next action inside an ego lite TaskSpace. The caller (you, or an LLM agent) supplies
// the goal and the values to type; Jev only chooses what to click and where each value goes.
//
//   ego-jev do "<goal>" [key=value ...] [--url U] [--space N] [--page p1] [--max 10] [--require R ...] [--allow-irreversible] [--finish] [--name NAME]
//   ego-jev check "<yes/no question>" [--space N] [--page p1]
//   ego-jev read "<question>" [--space N] [--page p1]
//   ego-jev proxy [--idle MINUTES] | proxy stop | proxy status
//
// The last line printed is `EGO_JEV_RESULT {json}`. Pass its `space` to --space to continue in the same TaskSpace.
//
// The ego runtime does not inherit environment variables, so the API key is handed over through a one-shot FIFO
// (mode 600) that the runtime reads once. The key is never written to disk.
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, realpathSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname, delimiter } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { request } from "node:http";
import { SOCKET, proxyAlive } from "../src/proxy.mjs";

const ROOT = join(dirname(realpathSync(fileURLToPath(import.meta.url))), "..");

const USAGE = `usage: ego-jev do|check|read "<text>" [key=value ...] [--url U] [--space N] [--page p1] [--max N] [--require R ...] [--allow-irreversible] [--finish] [--name NAME]
       ego-jev proxy [--idle MINUTES] | proxy status | proxy stop

  do      work toward a goal; key=value pairs are the values Jev may type or select
  check   yes/no question about the current page, answered as a probability
  read    the page text relevant to a question (Jev ranks blocks, code keeps the best)
  proxy   start a background process that holds TYPESAFE_API_KEY and forwards Jev requests over a unix socket
          (mode 600). While it runs, do/check/read need no key. It exits after --idle minutes without requests
          (default 120). "proxy stop" ends it, "proxy status" reports it

  --url U               open U first (otherwise continue on the current page)
  --space N             reuse TaskSpace N (default: create one named --name or "ego-jev")
  --page p1             page label inside the TaskSpace (default p1)
  --max N               action budget for do (default 10)
  --require R           a page state do has to reach; repeat for several, in the order they should be reached.
                        Each round works on the first one not reached yet
  --allow-irreversible  let do click through steps that look hard to undo (orders, payments, deletes)
  --no-batch-fill       type one value per round instead of filling every matching empty field at once
  --no-merge-require    score requirements in a separate request every round instead of with the action
  --finish              close the TaskSpace afterwards

environment: TYPESAFE_API_KEY (required unless a proxy runs), EGO_BROWSER (path to ego-browser, optional),
             EGO_JEV_SOCKET (proxy socket, default ~/.cache/ego-jev/jev.sock)`;

const fail = msg => { console.error(msg); process.exit(2); };
const argv = process.argv.slice(2);
if (!argv.length || ["-h", "--help", "help"].includes(argv[0])) { console.log(USAGE); process.exit(0); }
const cmd = argv.shift();
if (cmd === "proxy") await proxyCommand(argv);
if (!["do", "check", "read"].includes(cmd)) fail(USAGE);
const A = { cmd, values: {} };
for (let k = 0; k < argv.length; k++) {
  const a = argv[k];
  if (a === "--url") A.url = argv[++k];
  else if (a === "--space") A.space = argv[++k];
  else if (a === "--page") A.page = argv[++k];
  else if (a === "--max") A.max = Number(argv[++k]);
  else if (a === "--name") A.name = argv[++k];
  else if (a === "--allow-irreversible") A.allowIrreversible = true;
  else if (a === "--finish") A.finish = true;
  else if (a === "--require") (A.require ??= []).push(argv[++k]);
  else if (a === "--no-batch-fill") A.batchFill = false;
  else if (a === "--no-merge-require") A.mergeRequire = false;
  else if (a.startsWith("--")) fail(USAGE);
  else if (A.goal == null) A.goal = a;
  else { const i = a.indexOf("="); if (i < 1) fail(USAGE); A.values[a.slice(0, i)] = a.slice(i + 1); }
}
if (!A.goal) fail(USAGE);

const key = process.env.TYPESAFE_API_KEY;
if (!key) {
  if (await proxyAlive()) A.proxy = SOCKET;
  else fail("TYPESAFE_API_KEY is not set and no ego-jev proxy is running. Export the key, wrap the call with your secret manager, or start `ego-jev proxy` once under it.");
}

const which = name => (process.env.PATH ?? "").split(delimiter).map(d => join(d, name)).find(p => existsSync(p));
const egoBrowser = [process.env.EGO_BROWSER, which("ego-browser"), join(homedir(), ".local/bin/ego-browser")].find(p => p && existsSync(p));
if (!egoBrowser) fail("ego-browser was not found. Install ego lite (https://github.com/citrolabs/ego-lite) and finish its onboarding.");

if (!A.proxy) {
  A.keyFifo = join(tmpdir(), `ego-jev-${randomBytes(6).toString("hex")}.fifo`);
  if (spawnSync("mkfifo", ["-m", "600", A.keyFifo]).status !== 0) fail("could not create a FIFO for the API key");
}
const cleanup = () => A.keyFifo && rmSync(A.keyFifo, { force: true });

const script = [
  `globalThis.EGO_JEV_ARGS = ${JSON.stringify(A)};`,
  `globalThis.EGO_JEV_EGO = { taskSpace };`,
  `await import(${JSON.stringify(pathToFileURL(join(ROOT, "src/run.mjs")).href)});`,
].join("\n");

const env = { ...process.env }; delete env.TYPESAFE_API_KEY;
const child = spawn(egoBrowser, ["nodejs"], { stdio: ["pipe", "pipe", "pipe"], env });
child.stdin.end(script);
// The ego runtime writes console.log to stderr when its stdout is not a terminal. Route ego-jev's own lines (progress
// and the result) to stdout and everything else (runtime errors) to stderr, so `ego-jev ... | tail -1` works.
const OURS = /^(EGO_JEV_RESULT |\s+r\d+:|\s+!|\s+(verify|confirm)=|\s+also typed )/;
for (const s of [child.stdout, child.stderr]) {
  createInterface({ input: s }).on("line", l => (OURS.test(l) ? process.stdout : process.stderr).write(l + "\n"));
}
// Opening a FIFO for writing waits until the runtime opens it for reading.
if (A.keyFifo) {
  const w = createWriteStream(A.keyFifo);
  w.on("error", () => {});
  w.end(key);
}
child.on("close", code => { cleanup(); process.exitCode = code ?? 1; });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { child.kill(sig); cleanup(); process.exit(130); });

async function proxyCommand(args) {
  const sub = args[0] && !args[0].startsWith("--") ? args.shift() : "start";
  const alive = await proxyAlive();
  if (sub === "status") { console.log(alive ? `running on ${SOCKET}` : "not running"); process.exit(alive ? 0 : 1); }
  if (sub === "stop") {
    if (!alive) { console.log("not running"); process.exit(0); }
    await new Promise(res => { const r = request({ socketPath: SOCKET, path: "/stop", method: "POST" }, s => { s.resume(); s.on("end", res); }); r.on("error", res); r.end(); });
    console.log("stopped"); process.exit(0);
  }
  if (sub !== "start") fail(USAGE);
  if (alive) { console.log(`already running on ${SOCKET}`); process.exit(0); }
  if (!process.env.TYPESAFE_API_KEY) fail("TYPESAFE_API_KEY is not set; start the proxy under your secret manager, e.g. op run --env-file keys.env -- ego-jev proxy");
  const k = args.indexOf("--idle");
  const idle = (k >= 0 ? Number(args[k + 1]) : 120) * 60_000;
  const code = `const { serveFromStdin } = await import(${JSON.stringify(pathToFileURL(join(ROOT, "src/proxy.mjs")).href)}); await serveFromStdin({ idle: ${idle} });`;
  // the key goes over stdin; the child's environment (readable with ps eww) does not carry it
  const env = { ...process.env }; delete env.TYPESAFE_API_KEY;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { detached: true, stdio: ["pipe", "ignore", "ignore"], env });
  child.stdin.end(process.env.TYPESAFE_API_KEY);
  child.unref();
  for (let i = 0; i < 30 && !(await proxyAlive()); i++) await new Promise(r => setTimeout(r, 100));
  if (!(await proxyAlive())) fail("the proxy did not start");
  console.log(`running on ${SOCKET}`); process.exit(0);
}
