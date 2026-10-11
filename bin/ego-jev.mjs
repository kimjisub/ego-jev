#!/usr/bin/env node
// ego-jev: let Jev pick the next action inside an ego lite TaskSpace. The caller (you, or an LLM agent) supplies
// the goal and the values to type; Jev only chooses what to click and where each value goes.
//
//   ego-jev do "<goal>" [key=value ...] [--url U] [--space N] [--page p1] [--max 10] [--allow-irreversible] [--finish] [--name NAME]
//   ego-jev check "<yes/no question>" [--space N] [--page p1]
//   ego-jev read "<question>" [--space N] [--page p1]
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

const ROOT = join(dirname(realpathSync(fileURLToPath(import.meta.url))), "..");

const USAGE = `usage: ego-jev do|check|read "<text>" [key=value ...] [--url U] [--space N] [--page p1] [--max N] [--allow-irreversible] [--finish] [--name NAME]

  do      work toward a goal; key=value pairs are the values Jev may type or select
  check   yes/no question about the current page, answered as a probability
  read    the page text relevant to a question (Jev ranks blocks, code keeps the best)

  --url U               open U first (otherwise continue on the current page)
  --space N             reuse TaskSpace N (default: create one named --name or "ego-jev")
  --page p1             page label inside the TaskSpace (default p1)
  --max N               action budget for do (default 10)
  --allow-irreversible  let do click through steps that look hard to undo (orders, payments, deletes)
  --finish              close the TaskSpace afterwards

environment: TYPESAFE_API_KEY (required), EGO_BROWSER (path to ego-browser, optional)`;

const fail = msg => { console.error(msg); process.exit(2); };
const argv = process.argv.slice(2);
if (!argv.length || ["-h", "--help", "help"].includes(argv[0])) { console.log(USAGE); process.exit(0); }
const cmd = argv.shift();
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
  else if (a.startsWith("--")) fail(USAGE);
  else if (A.goal == null) A.goal = a;
  else { const i = a.indexOf("="); if (i < 1) fail(USAGE); A.values[a.slice(0, i)] = a.slice(i + 1); }
}
if (!A.goal) fail(USAGE);

const key = process.env.TYPESAFE_API_KEY;
if (!key) fail("TYPESAFE_API_KEY is not set. Get a key from TypeSafe and export it, or wrap the call with your secret manager.");

const which = name => (process.env.PATH ?? "").split(delimiter).map(d => join(d, name)).find(p => existsSync(p));
const egoBrowser = [process.env.EGO_BROWSER, which("ego-browser"), join(homedir(), ".local/bin/ego-browser")].find(p => p && existsSync(p));
if (!egoBrowser) fail("ego-browser was not found. Install ego lite (https://github.com/citrolabs/ego-lite) and finish its onboarding.");

A.keyFifo = join(tmpdir(), `ego-jev-${randomBytes(6).toString("hex")}.fifo`);
if (spawnSync("mkfifo", ["-m", "600", A.keyFifo]).status !== 0) fail("could not create a FIFO for the API key");
const cleanup = () => rmSync(A.keyFifo, { force: true });

const script = [
  `globalThis.EGO_JEV_ARGS = ${JSON.stringify(A)};`,
  `globalThis.EGO_JEV_EGO = { taskSpace };`,
  `await import(${JSON.stringify(pathToFileURL(join(ROOT, "src/run.mjs")).href)});`,
].join("\n");

const env = { ...process.env }; delete env.TYPESAFE_API_KEY;
const child = spawn(egoBrowser, ["nodejs"], { stdio: ["pipe", "inherit", "inherit"], env });
child.stdin.end(script);
// Opening a FIFO for writing waits until the runtime opens it for reading.
const w = createWriteStream(A.keyFifo);
w.on("error", () => {});
w.end(key);
child.on("exit", code => { cleanup(); process.exit(code ?? 1); });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { child.kill(sig); cleanup(); process.exit(130); });
