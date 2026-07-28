import { getUsers, saveUsers, hashPassword, makeToken, normalizeUsername } from "@/lib/auth";
import { setJSON } from "@/lib/redis";
import { settingsForDomain } from "@/lib/seed";
import { rateLimit, clientIp } from "@/lib/ratelimit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req) {
  const ip = clientIp(req);
  if (!(await rateLimit(`rl:signup:${ip}`, 8, 3600))) {
    return Response.json({ error: "Too many signup attempts from this connection. Try again later." }, { status: 429 });
  }

  const { username, password, inviteCode, domain, email } = await req.json();

  if (process.env.INVITE_CODE && inviteCode !== process.env.INVITE_CODE) {
    return Response.json({ error: "Invalid invite code. Ask the person who shared this app with you." }, { status: 403 });
  }
  const u = normalizeUsername(username);
  if (u.length < 3) return Response.json({ error: "Username must be at least 3 characters (letters/numbers)." }, { status: 400 });
  if ((password || "").length < 8) return Response.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  const trimmedEmail = (email || "").trim();
  if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) {
    return Response.json({ error: "That doesn't look like a valid email address." }, { status: 400 });
  }

  const users = await getUsers();
  if (users[u]) return Response.json({ error: "That username is taken — pick another." }, { status: 409 });
  if (Object.keys(users).length >= 25) return Response.json({ error: "This app has reached its member limit." }, { status: 403 });

  users[u] = { pw: hashPassword(password), domain: domain || "Sales", email: trimmedEmail, createdAt: new Date().toISOString() };
  await saveUsers(users);
  await setJSON(`settings:${u}`, settingsForDomain(domain));
  await setJSON(`companies:${u}`, []);
  await setJSON(`applications:${u}`, []);

  return Response.json({ token: makeToken(u), username: u });
}
