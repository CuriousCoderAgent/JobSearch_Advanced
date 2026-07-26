import crypto from "crypto";
import { getJSON, setJSON } from "./redis";

const SECRET = () => process.env.SESSION_SECRET || "";

// ---------- Password hashing (scrypt) ----------
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
export function verifyPassword(password, stored) {
  const [salt, hash] = (stored || "").split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(test, "hex"));
}

// ---------- Session tokens ----------
export function makeToken(username) {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 90; // 90 days
  const body = Buffer.from(JSON.stringify({ u: username, e: exp })).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET()).update(body).digest("base64url");
  return `${body}.${sig}`;
}
export function readToken(token) {
  try {
    const [body, sig] = (token || "").split(".");
    const expect = crypto.createHmac("sha256", SECRET()).update(body).digest("base64url");
    if (sig !== expect) return null;
    const data = JSON.parse(Buffer.from(body, "base64url").toString());
    if (Date.now() > data.e) return null;
    return data.u;
  } catch { return null; }
}

// ---------- Request helpers ----------
export function currentUser(req) {
  return readToken(req.headers.get("x-session"));
}
export const denied = () => Response.json({ error: "Please sign in again." }, { status: 401 });

// ---------- User store ----------
export async function getUsers() {
  return (await getJSON("users", {})) || {};
}
export async function saveUsers(users) {
  return setJSON("users", users);
}
export function normalizeUsername(u) {
  return (u || "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 30);
}
