import { currentUser, denied } from "@/lib/auth";
import { bumpUsage, touchLastActive } from "@/lib/usage";

export const maxDuration = 60;

export async function POST(req) {
  const user = currentUser(req);
  if (!user) return denied();
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY is not set in Vercel environment variables." }, { status: 500 });
  }

  const { cvText, jobTitle, jobCompany, jobDescription } = await req.json();
  if (!cvText || !cvText.trim()) return Response.json({ error: "No CV text to score yet." }, { status: 400 });
  if (!jobDescription || !jobDescription.trim()) return Response.json({ error: "Paste the job description first — the score needs something to compare against." }, { status: 400 });

  const system =
    "You are a blunt, precise recruiter screening a CV against a job description. " +
    "Reply with ONLY a JSON object, no prose, no markdown fences: " +
    '{"score": integer 0-100, "verdict": short phrase (max 6 words), "strengths": array of up to 5 short strings (what already matches well), ' +
    '"gaps": array of up to 5 short strings (what is missing or weak, phrased as an action the candidate could take), ' +
    '"missingKeywords": array of up to 8 short strings (important terms from the JD not present in the CV)}. ' +
    "Be honest — do not inflate the score to be encouraging.";

  const prompt = [
    `TARGET ROLE: ${jobTitle || "the role below"}${jobCompany ? " at " + jobCompany : ""}`,
    `JOB DESCRIPTION:\n${jobDescription}`,
    `CANDIDATE'S CV:\n${cvText.slice(0, 20000)}`
  ].join("\n\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      system,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!res.ok) {
    const t = await res.text();
    return Response.json({ error: `Claude API error (${res.status}): ${t.slice(0, 300)}` }, { status: 502 });
  }
  const data = await res.json();
  const raw = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return Response.json({ error: "Couldn't parse the score. Try again." }, { status: 502 });
  let result;
  try { result = JSON.parse(m[0]); } catch { return Response.json({ error: "Couldn't parse the score. Try again." }, { status: 502 }); }
  await bumpUsage(`usage:claude:${user}`);
  await touchLastActive(user);
  return Response.json({ result });
}
