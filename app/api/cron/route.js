import webpush from "web-push";
import { runSweep } from "@/lib/jobs";
import { getJSON, setJSON } from "@/lib/redis";
import { getUsers } from "@/lib/auth";
import { sendEmail } from "@/lib/email";

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

  const origin = req.headers.get("origin") || new URL(req.url).origin;
  const users = await getUsers();
  const usernames = Object.keys(users);
  const summary = [];

  for (const user of usernames) {
    try {
      const sweep = await runSweep(user);
      const fresh = sweep.results.flatMap((r) => r.matches).filter((m) => m.isNew);

      const subs = (await getJSON(`pushSubs:${user}`, [])) || [];
      let sent = 0;
      if (subs.length && process.env.VAPID_PRIVATE_KEY) {
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

      let emailed = false;
      const email = users[user]?.email;
      if (email) {
        const rows = fresh.slice(0, 15)
          .map((m) => `<li><a href="${m.url}">${m.title}</a> — ${m.company}${m.location ? ` · ${m.location}` : ""}</li>`)
          .join("");
        const subject = sweep.newCount > 0
          ? `${sweep.newCount} new match${sweep.newCount > 1 ? "es" : ""} today — JobRadar`
          : "JobRadar: sweep done, no new matches today";
        const html = sweep.newCount > 0
          ? `<p>Your 5 PM sweep found ${sweep.newCount} new relevant opening${sweep.newCount > 1 ? "s" : ""} across ${sweep.companiesScanned} companies:</p><ul>${rows}</ul><p><a href="${origin}">Open JobRadar</a></p>`
          : `<p>Today's sweep checked ${sweep.companiesScanned} companies — no new relevant openings. ${sweep.matchCount} known matches are still open.</p><p><a href="${origin}">Open JobRadar</a></p>`;
        const result = await sendEmail({ to: email, subject, html });
        emailed = result.sent;
      }

      summary.push({ user, newCount: sweep.newCount, notified: sent, emailed });
    } catch (e) {
      summary.push({ user, error: String(e).slice(0, 120) });
    }
  }

  return Response.json({ ok: true, users: usernames.length, summary });
}
