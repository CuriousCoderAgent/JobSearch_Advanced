import { runSweep } from "@/lib/jobs";
import { getJSON } from "@/lib/redis";
import { currentUser, denied } from "@/lib/auth";

export const maxDuration = 60;

export async function GET(req) {
  const user = currentUser(req);
  if (!user) return denied();
  const last = await getJSON(`lastSweep:${user}`);
  return Response.json({ sweep: last });
}

export async function POST(req) {
  const user = currentUser(req);
  if (!user) return denied();
  const sweep = await runSweep(user);
  return Response.json({ sweep });
}
