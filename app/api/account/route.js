import { getUsers, saveUsers, currentUser, denied } from "@/lib/auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(req) {
  const user = currentUser(req);
  if (!user) return denied();
  const users = await getUsers();
  return Response.json({ email: users[user]?.email || "" });
}

export async function POST(req) {
  const user = currentUser(req);
  if (!user) return denied();
  const { email } = await req.json();
  const trimmed = (email || "").trim();
  if (trimmed && !EMAIL_RE.test(trimmed)) {
    return Response.json({ error: "That doesn't look like a valid email address." }, { status: 400 });
  }
  const users = await getUsers();
  if (!users[user]) return denied();
  users[user].email = trimmed;
  await saveUsers(users);
  return Response.json({ ok: true });
}
