// Minimal Upstash Redis REST client (no SDK needed).
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

async function cmd(...args) {
  const res = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store"
  });
  if (!res.ok) throw new Error(`Redis error ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.result;
}

export async function getJSON(key, fallback = null) {
  const v = await cmd("GET", key);
  if (v === null || v === undefined) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}
export async function setJSON(key, value) {
  return cmd("SET", key, JSON.stringify(value));
}
export { cmd };
