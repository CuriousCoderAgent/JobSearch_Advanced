import { getJSON, setJSON } from "@/lib/redis";
import { settingsForDomain } from "@/lib/seed";
import { currentUser, denied } from "@/lib/auth";

export async function GET(req) {
  const user = currentUser(req);
  if (!user) return denied();
  let settings = await getJSON(`settings:${user}`);
  if (!settings) { settings = settingsForDomain("Sales"); await setJSON(`settings:${user}`, settings); }
  return Response.json({ settings });
}

export async function POST(req) {
  const user = currentUser(req);
  if (!user) return denied();
  const { settings } = await req.json();
  await setJSON(`settings:${user}`, settings);
  return Response.json({ ok: true });
}
