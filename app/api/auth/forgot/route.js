import { getUsers, makeResetToken } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { rateLimit, clientIp } from "@/lib/ratelimit";

const GENERIC_MESSAGE = "If that email is registered, a reset link is on its way.";

export async function POST(req) {
  const ip = clientIp(req);
  if (!(await rateLimit(`rl:forgot:${ip}`, 6, 3600))) {
    return Response.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }

  const { email } = await req.json();
  const trimmed = (email || "").trim().toLowerCase();

  if (trimmed) {
    const users = await getUsers();
    const match = Object.entries(users).find(([, u]) => (u.email || "").toLowerCase() === trimmed);
    if (match) {
      const [username] = match;
      const token = makeResetToken(username);
      const origin = req.headers.get("origin") || new URL(req.url).origin;
      const link = `${origin}/reset?token=${token}`;
      await sendEmail({
        to: email,
        subject: "Reset your JobRadar password",
        html: `<p>Someone (hopefully you) asked to reset the JobRadar password for <b>${username}</b>.</p>` +
          `<p><a href="${link}">Click here to set a new password</a>. This link expires in 30 minutes.</p>` +
          `<p>If this wasn't you, you can ignore this email.</p>`
      });
    }
  }

  // Always the same response, whether or not the email was found — avoids leaking who has an account.
  return Response.json({ ok: true, message: GENERIC_MESSAGE });
}
