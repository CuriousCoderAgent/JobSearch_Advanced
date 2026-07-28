import { getJSON, setJSON } from "@/lib/redis";
import { currentUser, denied } from "@/lib/auth";

export async function GET(req) {
  const user = currentUser(req);
  if (!user) return denied();
  const applications = (await getJSON(`applications:${user}`, [])) || [];
  return Response.json({ applications });
}

export async function POST(req) {
  const user = currentUser(req);
  if (!user) return denied();
  const { applications } = await req.json();
  if (!Array.isArray(applications)) return Response.json({ error: "applications must be a list" }, { status: 400 });
  await setJSON(`applications:${user}`, applications.slice(0, 300));
  return Response.json({ ok: true });
}
