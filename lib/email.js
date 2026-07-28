// Minimal Resend email client (fetch-based, no SDK — same style as lib/redis.js).
const API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM || "JobRadar <onboarding@resend.dev>";

export async function sendEmail({ to, subject, html }) {
  if (!API_KEY || !to) return { sent: false };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject, html })
    });
    return { sent: res.ok };
  } catch {
    return { sent: false };
  }
}
