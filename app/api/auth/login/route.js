import { getUsers, verifyPassword, makeToken, normalizeUsername } from "@/lib/auth";

export async function POST(req) {
  const { username, password } = await req.json();
  const u = normalizeUsername(username);
  const users = await getUsers();
  if (!users[u] || !verifyPassword(password || "", users[u].pw)) {
    return Response.json({ error: "Wrong username or password." }, { status: 401 });
  }
  return Response.json({ token: makeToken(u), username: u });
}
