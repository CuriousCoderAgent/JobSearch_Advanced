import { getJSON } from "@/lib/redis";
import { currentUser, denied } from "@/lib/auth";

export const maxDuration = 60;

export async function POST(req) {
  const user = currentUser(req);
  if (!user) return denied();
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY is not set in Vercel environment variables." }, { status: 500 });
  }

  const { jobTitle, jobCompany, jobDescription, baseCvText, mode } = await req.json();
  const settings = (await getJSON(`settings:${user}`, {})) || {};

  const system =
    "You are an expert CV writer for professionals in India across functions (finance, sales, marketing, technology, HR, operations). " +
    "Write in crisp, achievement-led language. Quantify wherever the source material allows; never invent numbers or employers. " +
    "Output clean Markdown only: name/contact placeholder block, professional summary, core strengths, experience (reverse chronological), education. " +
    "Tailor the summary and the top bullets tightly to the target role's language. Keep to roughly two pages.";

  const prompt = [
    `TARGET ROLE: ${jobTitle || "Senior enterprise sales leadership role"}${jobCompany ? " at " + jobCompany : ""}`,
    jobDescription ? `JOB DESCRIPTION / KEY REQUIREMENTS:\n${jobDescription}` : "",
    `CANDIDATE PROFILE SUMMARY:\n${settings.profile || ""}`,
    baseCvText
      ? `EXISTING CV TO REWORK (preserve all real facts, employers and dates; improve framing and tailor to the role):\n${baseCvText}`
      : "No existing CV provided — build the best possible structure from the profile summary, with clear [placeholders] where specifics are needed.",
    mode === "coverletter"
      ? "TASK: Write a tailored one-page cover letter instead of a CV."
      : "TASK: Produce the tailored CV."
  ].filter(Boolean).join("\n\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!res.ok) {
    const t = await res.text();
    return Response.json({ error: `Claude API error (${res.status}): ${t.slice(0, 300)}` }, { status: 502 });
  }
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  return Response.json({ text });
}
