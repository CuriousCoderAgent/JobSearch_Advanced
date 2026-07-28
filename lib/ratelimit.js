import { cmd } from "./redis";

// Fixed-window rate limit backed by Redis INCR/EXPIRE. Returns true if the
// request is allowed, false if the caller has exceeded `limit` within `windowSeconds`.
export async function rateLimit(key, limit, windowSeconds) {
  const count = await cmd("INCR", key);
  if (count === 1) await cmd("EXPIRE", key, windowSeconds);
  return count <= limit;
}

export function clientIp(req) {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}
