import { getUsers, currentUser, isAdmin, denied } from "@/lib/auth";
import { getJSON } from "@/lib/redis";

export async function GET(req) {
  const me = currentUser(req);
  if (!me) return denied();
  if (!isAdmin(me)) return Response.json({ error: "Not authorized." }, { status: 403 });

  const users = await getUsers();
  const rows = await Promise.all(Object.entries(users).map(async ([username, u]) => {
    const [companies, cvs, applications, sweeps, claudeCalls, lastActive] = await Promise.all([
      getJSON(`companies:${username}`, []),
      getJSON(`cvs:${username}`, []),
      getJSON(`applications:${username}`, []),
      getJSON(`usage:sweeps:${username}`, 0),
      getJSON(`usage:claude:${username}`, 0),
      getJSON(`lastActive:${username}`, null)
    ]);
    return {
      username,
      email: u.email || null,
      domain: u.domain || null,
      createdAt: u.createdAt || null,
      companies: (companies || []).length,
      cvs: (cvs || []).length,
      applications: (applications || []).length,
      sweeps: sweeps || 0,
      claudeCalls: claudeCalls || 0,
      lastActive
    };
  }));

  rows.sort((a, b) => (b.lastActive || "").localeCompare(a.lastActive || ""));
  return Response.json({ users: rows });
}
