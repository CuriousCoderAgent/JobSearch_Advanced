import { getJSON, setJSON } from "@/lib/redis";
import { currentUser, denied } from "@/lib/auth";

export async function POST(req) {
  const user = currentUser(req);
  if (!user) return denied();
  const { subscription } = await req.json();
  if (!subscription?.endpoint) return Response.json({ error: "No subscription" }, { status: 400 });
  const key = `pushSubs:${user}`;
  const subs = (await getJSON(key, [])) || [];
  const next = subs.filter((s) => s.endpoint !== subscription.endpoint);
  next.push(subscription);
  await setJSON(key, next.slice(-5));
  return Response.json({ ok: true });
}
