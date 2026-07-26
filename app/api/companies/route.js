import { getJSON, setJSON } from "@/lib/redis";
import { currentUser, denied } from "@/lib/auth";

export async function GET(req) {
  const user = currentUser(req);
  if (!user) return denied();
  const companies = (await getJSON(`companies:${user}`, [])) || [];
  return Response.json({ companies });
}

export async function POST(req) {
  const user = currentUser(req);
  if (!user) return denied();
  const { companies } = await req.json();
  if (!Array.isArray(companies)) return Response.json({ error: "companies must be a list" }, { status: 400 });
  await setJSON(`companies:${user}`, companies.slice(0, 60));
  return Response.json({ ok: true });
}
