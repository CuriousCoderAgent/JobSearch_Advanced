import { getJSON, setJSON } from "@/lib/redis";
import { currentUser, denied } from "@/lib/auth";

export async function GET(req) {
  const user = currentUser(req);
  if (!user) return denied();
  const cvs = (await getJSON(`cvs:${user}`, [])) || [];
  return Response.json({ cvs });
}

export async function POST(req) {
  const user = currentUser(req);
  if (!user) return denied();
  const { cvs } = await req.json();
  if (!Array.isArray(cvs)) return Response.json({ error: "cvs must be a list" }, { status: 400 });
  await setJSON(`cvs:${user}`, cvs.slice(0, 12));
  return Response.json({ ok: true });
}
