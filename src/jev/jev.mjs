// Minimal client for the Typesafe System One API (model: Jev).
// Jev answers typed questions over a state object; it never generates text.
// From jev-browser 0.1.2 (MIT, Ying-Kai Liao). Changed: the key comes only from TYPESAFE_API_KEY (no .env lookup).
export const API_URL = process.env.JEV_API_URL || "https://api.typesafe.ai/v1/systemone";
export const MODEL = process.env.JEV_MODEL || "jev-latest";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function apiKey() {
  const k = process.env.TYPESAFE_API_KEY;
  if (!k) throw new Error("No TypeSafe API key: set TYPESAFE_API_KEY");
  return k;
}

// questions: { name: { type: "noul" | "choice" | "score", instructions, criteria? } }
export async function jev(state, questions, { retries = 2, timeout = 60_000 } = {}) {
  const key = apiKey();
  for (let attempt = 0; ; attempt++) {
    const t = performance.now();
    let res, body;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ state, model: MODEL, questions }),
        signal: AbortSignal.timeout(timeout),
      });
      body = await res.json().catch(() => ({}));
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
