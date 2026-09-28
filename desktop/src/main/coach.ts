import { z } from 'zod'
import type Anthropic from '@anthropic-ai/sdk'
import { coachParse, coachStream } from './ai'
import { read } from './store'
import type {
  Application, CvVersion, DeliveryMetrics, PracticeFeedback, Profile, Question, Track
} from '../shared/types'

// The coach's voice. Kept stable (and cached) across every coaching call.
function persona(): string {
  const p = read<Profile>('profile', {} as Profile)
  const name = p.name?.split(' ')[0] || 'the candidate'
  return [
    `You are ${name}'s personal career coach for a senior enterprise-sales job switch in India. You have skin in the game:`,
    `you succeed only when ${name} lands an offer they are proud of. You coach like a former VP of Sales who has hired`,
    'hundreds of enterprise sellers and sales leaders: direct, specific, warm but never flattering. You hold the bar of a',
    'demanding interview panel at a top B2B tech company. You praise only what is genuinely strong, and every criticism',
    'comes with a concrete fix.',
    '',
    'Ground rules:',
    `- Never invent facts, employers, numbers, clients or results about ${name}. Where a specific fact is needed and not`,
    '  provided, write a clear [placeholder like: deal size in ₹ crore] for them to fill in.',
    '- Write in a natural, confident first-person spoken voice for interview answers: short sentences, no jargon soup,',
    '  numbers early, a clear point of view.',
    '- Senior-executive standard: structure (situation, stakes, what I did, measurable result, what I learned), crisp',
    '  numbers, conviction, commercial acumen, and leadership presence.',
    '- Use Indian business context and ₹ / crore / lakh when talking money unless the source uses another currency.',
    '',
    `## About ${name}`,
    profileContext(p)
  ].join('\n')
}

function profileContext(p: Profile): string {
  const cvs = read<CvVersion[]>('cvs', [])
  const master = cvs.find((c) => c.id === p.masterCvId) ?? cvs.find((c) => c.kind === 'master') ?? cvs[0]
  return [
    p.name ? `Name: ${p.name}` : '',
    p.headline ? `Headline: ${p.headline}` : '',
    p.targetRoles?.length ? `Target roles: ${p.targetRoles.join('; ')}` : '',
    p.targetBrief ? `What they want next: ${p.targetBrief}` : '',
    p.locations ? `Locations: ${p.locations}` : '',
    p.background ? `Background in their own words:\n${p.background}` : '',
    master ? `\nTheir current CV:\n${master.text.slice(0, 30000)}` : '\n(No CV imported yet — use placeholders for specifics.)'
  ].filter(Boolean).join('\n')
}

const trackLabel = (tracks: Track[]): string =>
  tracks.length === 2 ? 'both senior IC and leadership roles'
    : tracks[0] === 'ic' ? 'senior individual-contributor roles (Enterprise Account Director)'
      : 'sales leadership roles (Head/VP Sales, Regional/National Head, Country Manager)'

// ---------- Question bank ----------

export async function modelAnswer(q: Question, app?: Application): Promise<string> {
  const out = await coachParse('prep: model answer', {
    system: persona(),
    effort: 'medium',
    schema: z.object({ answer: z.string(), keyPoints: z.array(z.string()), whyItWorks: z.string() }),
    content: [
      `Interview question (${q.category}, for ${trackLabel(q.tracks)}): "${q.text}"`,
      q.why ? `What the panel is testing: ${q.why}` : '',
      app ? `This is for: ${app.role} at ${app.company}.${app.jd ? `\nJob description:\n${app.jd.slice(0, 12000)}` : ''}` : '',
      '',
      'Write the strongest answer this candidate could honestly give, in their spoken voice, 60–120 seconds when spoken',
      '(roughly 150–280 words). Build it from their real background; use [placeholders] for any specific you do not know.',
      'Then list 3–5 key points to remember and one line on why this answer works.'
    ].filter(Boolean).join('\n')
  })
  return `${out.answer}\n\n**Key points to land**\n${out.keyPoints.map((k) => `- ${k}`).join('\n')}\n\n*Why this works:* ${out.whyItWorks}`
}

export async function critiqueAnswer(q: Question, answer: string) {
  return coachParse('prep: critique answer', {
    system: persona(),
    effort: 'high',
    schema: z.object({
      score: z.number().int().describe('0-100, where 80+ would impress a VP-level panel'),
      verdict: z.string(),
      strengths: z.array(z.string()),
      fixes: z.array(z.string()),
      tightened: z.string()
    }),
    content: [
      `Interview question: "${q.text}"`,
      q.why ? `What the panel is testing: ${q.why}` : '',
      '',
      'The candidate’s own written answer:',
      answer,
      '',
      'Critique it as a demanding senior interviewer. Score 0–100. Give a one-line verdict, the real strengths, and',
      'specific fixes (quote the weak phrasing and show the better version). Then give a tightened rewrite that keeps',
      'their facts and voice — do not add facts they did not provide.'
    ].filter(Boolean).join('\n')
  })
}

export async function questionsForJob(app: Application): Promise<{ text: string; category: string; tracks: Track[]; why: string }[]> {
  const out = await coachParse('prep: questions for a job', {
    system: persona(),
    effort: 'medium',
    schema: z.object({
      questions: z.array(z.object({
        text: z.string(),
        category: z.string(),
        tracks: z.array(z.string()).describe('Role tracks it applies to: "ic" (senior individual contributor) and/or "leader" (people leader)'),
        why: z.string()
      }))
    }),
    content: [
      `The candidate is interviewing for ${app.role} at ${app.company}.`,
      app.jd ? `Job description:\n${app.jd.slice(0, 15000)}` : '(No job description saved — infer from the title and company.)',
      '',
      'List the 10 questions this specific panel is most likely to ask, beyond the generic ones — tied to this company’s',
      'business, the role’s scope and any gaps between the candidate’s background and the job. Use categories from:',
      'Story & motivation, Deal execution, Numbers & forecasting, Team leadership, Strategy, GTM & P&L,',
      'Stakeholders & influence, Behavioural, Company-specific. For each, say what the panel is really testing.'
    ].join('\n')
  })
  // Enum constraints aren't enforced by the output schema, so normalise here.
  return out.questions.map((q) => {
    const tracks = q.tracks.map((t) => t.toLowerCase().trim()).filter((t): t is Track => t === 'ic' || t === 'leader')
    return { ...q, tracks: tracks.length ? [...new Set(tracks)] : ['ic', 'leader'] }
  })
}

// ---------- Practice feedback ----------

export async function practiceFeedback(opts: {
  question: Question
  transcript: string
  metrics: DeliveryMetrics
  mode: 'audio' | 'video'
  frames: string[]
}): Promise<PracticeFeedback> {
  const { question, transcript, metrics, mode, frames } = opts
  const content: Anthropic.Beta.BetaContentBlockParam[] = []
  if (mode === 'video' && frames.length) {
    content.push({ type: 'text', text: `${frames.length} frames sampled evenly across the recorded answer, in order:` })
    for (const f of frames) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: f } })
  }
  content.push({
    type: 'text',
    text: [
      `Practice interview question: "${question.text}"`,
      question.why ? `What the panel is testing: ${question.why}` : '',
      question.myAnswer ? `The answer they prepared in writing (for reference):\n${question.myAnswer}` : '',
      '',
      'Transcript of what they actually said (local speech-to-text; it can miss "um/uh", so trust the metrics for fillers):',
      transcript || '(empty — nothing was recognised)',
      '',
      'Measured delivery metrics:',
      JSON.stringify(metrics, null, 2),
      '',
      'Coach this attempt like a VP-level panel member debriefing a candidate they want to win. Score each dimension',
      '0–10 (bodyLanguage only for video, from eye contact, posture, expression and energy in the frames; otherwise null)',
      'and give an overall 0–100. Benchmarks: 130–160 words per minute is confident; more than 3 fillers per minute or',
      'frequent hedges ("I think", "kind of", "maybe") undercut executive presence; answers over ~2.5 minutes lose the',
      'room; low pitch variation reads as monotone. Quote their actual words as evidence for each fix. Then write the',
      '"power answer": how they should have said it — their facts, their voice, tighter and more senior. End with one',
      'specific drill for the next attempt. Say honestly whether this answer would get them to the next round.'
    ].filter(Boolean).join('\n')
  })
  const out = await coachParse('practice: feedback', {
    system: persona(),
    effort: 'high',
    schema: z.object({
      overall: z.number().int(),
      verdict: z.string(),
      wouldAdvance: z.string().describe('Exactly one of: "yes", "borderline", "no"'),
      scores: z.object({
        structure: z.number().int(), substance: z.number().int(), executivePresence: z.number().int(),
        delivery: z.number().int(), confidence: z.number().int(), bodyLanguage: z.number().int().nullable()
      }),
      strengths: z.array(z.string()),
      fixes: z.array(z.object({ issue: z.string(), evidence: z.string(), fix: z.string() })),
      powerAnswer: z.string(),
      drill: z.string()
    }),
    content
  })
  const w = out.wouldAdvance.toLowerCase()
  return { ...out, wouldAdvance: w.startsWith('y') ? 'yes' as const : w.startsWith('n') ? 'no' as const : 'borderline' as const }
}

// ---------- CV tailoring ----------

export async function tailorCv(base: CvVersion, app: Application) {
  return coachParse('cv: tailor', {
    system: persona(),
    effort: 'high',
    maxTokens: 24000,
    schema: z.object({
      cv: z.string().describe('The full tailored CV in Markdown'),
      changes: z.array(z.string()),
      keywordsMatched: z.array(z.string()),
      gaps: z.array(z.string())
    }),
    content: [
      `Tailor this CV for ${app.role} at ${app.company}.`,
      app.jd ? `Job description:\n${app.jd.slice(0, 15000)}` : '(No job description saved — tailor to the title and company.)',
      '',
      'Base CV (Markdown):',
      base.text,
      '',
      'Rules: keep every employer, title, date and number exactly as given — never invent. Rewrite the summary and',
      'reorder/reframe bullets so the most relevant proof for this role comes first, using the job’s language where it',
      'is truthful. Lead bullets with outcomes and numbers. Keep to about two pages. Output clean Markdown: name and',
      'contact block, professional summary, core strengths, experience (reverse chronological), education.',
      'Then list the changes you made, the job keywords now covered, and honest gaps the candidate should address.'
    ].join('\n')
  })
}

export async function coverLetter(cv: CvVersion, app: Application): Promise<string> {
  const out = await coachParse('cv: cover letter', {
    system: persona(),
    effort: 'medium',
    schema: z.object({ letter: z.string() }),
    content: [
      `Write a cover letter for ${app.role} at ${app.company}.`,
      app.jd ? `Job description:\n${app.jd.slice(0, 12000)}` : '',
      `The CV being sent:\n${cv.text}`,
      '',
      'One page, confident and specific, no clichés. Open with why this role at this company, prove fit with two or',
      'three concrete results from the CV, close with a clear ask. Use [placeholders] for anything unknown.'
    ].filter(Boolean).join('\n')
  })
  return out.letter
}

// ---------- Daily brief & chat ----------

export async function dailyBrief(snapshot: string) {
  return coachParse('coach: daily brief', {
    system: persona(),
    effort: 'low',
    maxTokens: 4000,
    schema: z.object({ headline: z.string(), focus: z.array(z.string()), pepTalk: z.string() }),
    content: [
      'Here is today’s snapshot of the job search:',
      snapshot,
      '',
      'Write today’s brief: a one-line headline, the three highest-leverage things to do today (specific, doable in',
      'under an hour each), and a two-sentence pep talk that is honest, not cheesy.'
    ].join('\n')
  })
}

export async function chat(
  history: { role: 'user' | 'assistant'; content: string }[],
  snapshot: string,
  onText: (delta: string) => void
): Promise<string> {
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({ role: m.role, content: m.content }))
  // Latest state rides on the newest user turn so the cached prefix stays stable.
  const last = messages[messages.length - 1]
  if (last && last.role === 'user' && typeof last.content === 'string') {
    last.content = `${last.content}\n\n<current_state>\n${snapshot}\n</current_state>`
  }
  return coachStream('coach: chat', { system: persona(), messages, onText })
}
