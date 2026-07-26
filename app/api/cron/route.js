import webpush from "web-push";
import { runSweep } from "@/lib/jobs";
import { getJSON, setJSON } from "@/lib/redis";
import { getUsers } from "@/lib/auth";

export const maxDuration = 300;

export async function GET(req) {
  const auth = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:jobradar@example.com",
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
  }

  const users = Object.keys(await getUsers());
  const summary = [];

  for (const user of users) {
    try {
      const sweep = await runSweep(user);
      const subs = (await getJSON(`pushSubs:${user}`, [])) || [];
      let sent = 0;
      if (subs.length && process.env.VAPID_PRIVATE_KEY) {
        const fresh = sweep.results.flatMap((r) => r.matches).filter((m) => m.isNew);
        const top = fresh.slice(0, 3).map((m) => `${m.title} — ${m.company}`).join("\n");
        const payload = JSON.stringify({
          title: sweep.newCount > 0
            ? `JobRadar: ${sweep.newCount} new match${sweep.newCount > 1 ? "es" : ""} today`
            : `JobRadar: sweep done, ${sweep.companiesScanned} companies checked`,
          body: sweep.newCount > 0 ? top : `No new relevant openings today. ${sweep.matchCount} known matches still open.`,
          url: "/"
        });
        const alive = [];
        for (const sub of subs) {
          try { await webpush.sendNotification(sub, payload); alive.push(sub); sent++; }
          catch (e) { if (e.statusCode !== 404 && e.statusCode !== 410) alive.push(sub); }
        }
        await setJSON(`pushSubs:${user}`, alive);
      }
      summary.push({ user, newCount: sweep.newCount, notified: sent });
    } catch (e) {
      summary.push({ user, error: String(e).slice(0, 120) });
    }
  }

  return Response.json({ ok: true, users: users.length, summary });
}
