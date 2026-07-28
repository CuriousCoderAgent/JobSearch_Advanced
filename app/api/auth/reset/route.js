import { getUsers, saveUsers, hashPassword, readResetToken } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export async function POST(req) {
  const ip = clientIp(req);
  if (!(await rateLimit(`rl:reset:${ip}`, 10, 3600))) {
    return Response.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const { token, newPassword } = await req.json();
  const username = readResetToken(token);
  if (!username) return Response.json({ error: "This reset link is invalid or has expired — request a new one." }, { status: 400 });
  if ((newPassword || "").length < 8) return Response.json({ error: "Password must be at least 8 characters." }, { status: 400 });

  const users = await getUsers();
  if (!users[username]) return Response.json({ error: "Account not found." }, { status: 404 });
  users[username].pw = hashPassword(newPassword);
  await saveUsers(users);
  return Response.json({ ok: true });
}
