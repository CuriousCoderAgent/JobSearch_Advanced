import { getUsers, verifyPassword, makeToken, normalizeUsername } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { setJSON } from "@/lib/redis";

export async function POST(req) {
  const ip = clientIp(req);
  if (!(await rateLimit(`rl:login:ip:${ip}`, 20, 600))) {
    return Response.json({ error: "Too many attempts from this connection. Wait a few minutes and try again." }, { status: 429 });
  }

  const { username, password } = await req.json();
  const u = normalizeUsername(username);

  if (!(await rateLimit(`rl:login:user:${u}`, 8, 600))) {
    return Response.json({ error: "Too many attempts on this account. Wait a few minutes and try again." }, { status: 429 });
  }

  const users = await getUsers();
  if (!users[u] || !verifyPassword(password || "", users[u].pw)) {
    return Response.json({ error: "Wrong username or password." }, { status: 401 });
  }
  await setJSON(`lastActive:${u}`, new Date().toISOString());
  return Response.json({ token: makeToken(u), username: u });
}
