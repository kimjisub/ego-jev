// Minimal client for the Typesafe System One API (model: Jev).
// Jev answers typed questions over a state object; it never generates text.
// From jev-browser 0.1.2 (MIT, Ying-Kai Liao). Changed: the key comes from setApiKey() or TYPESAFE_API_KEY (no .env lookup).
export const API_URL = process.env.JEV_API_URL || "https://api.typesafe.ai/v1/systemone";
export const MODEL = process.env.JEV_MODEL || "jev-latest";
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Inside the ego runtime, process.env is shared by every script for the life of the runtime process, so the CLI
// hands the key over with setApiKey() and never puts it there.
let KEY = null;
export function setApiKey(k) { KEY = k; }
// With a local proxy (src/proxy.mjs) the requests go to its unix socket and no key is needed here.
let PROXY = null;
export function setProxy(socketPath) { PROXY = socketPath; }

async function viaProxy(payload, timeout) {
  const { request } = await import("node:http");
  return new Promise((res, rej) => {
    const r = request({ socketPath: PROXY, path: "/", method: "POST", headers: { "Content-Type": "application/json" }, timeout }, s => {
      const chunks = [];
      s.on("data", c => chunks.push(c));
      s.on("end", () => { let body = {}; try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch {} res({ ok: s.statusCode < 300, status: s.statusCode, body }); });
    });
    r.on("error", rej); r.on("timeout", () => r.destroy(new Error("Jev proxy timeout")));
    r.end(payload);
  });
}

export function apiKey() {
  const k = KEY ?? process.env.TYPESAFE_API_KEY;
  if (!k) throw new Error("No TypeSafe API key: set TYPESAFE_API_KEY");
  return k;
}

// questions: { name: { type: "noul" | "choice" | "score", instructions, criteria? } }
export async function jev(state, questions, { retries = 2, timeout = 60_000 } = {}) {
  const key = PROXY ? null : apiKey();
  const payload = JSON.stringify({ state, model: MODEL, questions });
  for (let attempt = 0; ; attempt++) {
    const t = performance.now();
    let res, body;
    try {
      if (PROXY) ({ body, ...res } = await viaProxy(payload, timeout));
      else {
        res = await fetch(API_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: payload,
          signal: AbortSignal.timeout(timeout),
        });
        body = await res.json().catch(() => ({}));
      }
    } catch (e) {
      if (attempt < retries) { await sleep(800 * (attempt + 1)); continue; }
      throw e;
    }
    const ms = Math.round(performance.now() - t);
    if (res.ok) return { answers: body.answers, ms, tokens: body.usage?.input_tokens ?? 0 };
    if (attempt < retries && (res.status === 429 || res.status >= 500)) { await sleep(800 * (attempt + 1)); continue; }
    throw new Error(`Jev ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
}
