// A local Jev proxy. It holds the API key in its own process and forwards Jev requests that arrive on a unix socket
// (mode 600, in a mode 700 directory), so later ego-jev calls need no key and skip the secret manager. The key is
// never sent back. Any process of the same user can send requests through it while it runs; it exits after
// `idle` ms without requests.
import { createServer, request } from "node:http";
import { mkdirSync, rmSync, chmodSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { API_URL } from "./jev/jev.mjs";

export const SOCKET = process.env.EGO_JEV_SOCKET ?? join(homedir(), ".cache", "ego-jev", "jev.sock");

// Resolves true when a proxy answers on the socket.
export function proxyAlive(socket = SOCKET) {
  if (!existsSync(socket)) return Promise.resolve(false);
  return new Promise(res => {
    const r = request({ socketPath: socket, path: "/ping", method: "GET", timeout: 1000 }, s => { s.resume(); res(s.statusCode === 200); });
    r.on("error", () => res(false)); r.on("timeout", () => { r.destroy(); res(false); });
    r.end();
  });
}

export function serve({ key, socket = SOCKET, idle = 2 * 3600_000 }) {
  mkdirSync(join(socket, ".."), { recursive: true, mode: 0o700 });
  chmodSync(join(socket, ".."), 0o700);
  rmSync(socket, { force: true });
  let timer;
  const bump = () => { clearTimeout(timer); timer = setTimeout(() => { server.close(); rmSync(socket, { force: true }); process.exit(0); }, idle); };
  const server = createServer(async (req, res) => {
    bump();
    if (req.method === "GET" && req.url === "/ping") { res.end("ok"); return; }
    if (req.method === "POST" && req.url === "/stop") { rmSync(socket, { force: true }); res.end("bye", () => process.exit(0)); return; }
    if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    try {
      const up = await fetch(API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: Buffer.concat(chunks),
        signal: AbortSignal.timeout(60_000),
      });
      res.statusCode = up.status;
      res.setHeader("Content-Type", "application/json");
      res.end(Buffer.from(await up.arrayBuffer()));
    } catch (e) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: String(e.message ?? e) }));
    }
  });
  server.listen(socket, () => { chmodSync(socket, 0o600); bump(); });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { rmSync(socket, { force: true }); process.exit(0); });
  return server;
}
