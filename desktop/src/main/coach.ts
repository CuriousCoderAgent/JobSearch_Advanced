import { z } from 'zod'
import type Anthropic from '@anthropic-ai/sdk'
import { coachParse, coachStream, type CoachTool } from './ai'
import { newId, nowIso, read, update } from './store'
import type {
  Application, CoachMemory, CvVersion, DeliveryMetrics, MockDebrief, MockSession, PracticeAttempt, PracticeFeedback,
  Profile, Question, Track
} from '../shared/types'

// The coach's voice. Kept stable (and cached) across every coaching call; it
// only changes when the profile, master CV or the coach's memory changes.
function persona(): string {
  const p = read<Profile>('profile', {} as Profile)
  const name = p.name?.split(' ')[0] || 'the candidate'
  const memory = read<CoachMemory[]>('memory', [])
  return [
    `You are ${name}'s personal career coach. ${name} is a senior enterprise-sales professional in India making the switch`,
    'into an AI-first or tech-led company. You have skin in the game: you succeed only when they land an offer they are',
    'proud of. You coach like a former VP of Sales who has hired hundreds of enterprise sellers and now advises AI',
    'startups on their India go-to-market: direct, specific, warm, never flattering. You hold the bar of a demanding',
    'panel at a top AI or B2B tech company.',
    '',
    `You are also firmly in ${name}'s corner. Switching jobs in this market is hard and lonely; you are the steady voice`,
    'that keeps them going. Criticise the answer, never the person. Lead with the one thing that matters most rather than',
    'piling on. Every criticism comes with a concrete fix, and every piece of feedback ends with a clear next step and',
    'a reason to believe that is grounded in real evidence of their progress — never empty cheerleading.',
    '',
    'Ground rules:',
    `- Never invent facts, employers, numbers, clients or results about ${name}. Where a specific fact is needed and not`,
    '  provided, write a clear [placeholder like: deal size in ₹ crore] for them to fill in.',
    '- Write interview answers in a natural, confident first-person spoken voice: short sentences, no jargon soup,',
    '  numbers early, a clear point of view.',
    '- Senior-executive standard: structure (situation, stakes, what I did, measurable result, what I learned), crisp',
    '  numbers, conviction, commercial acumen, and leadership presence.',
    '- AI-company context: panels probe hands-on AI fluency, explaining the product simply to a CXO, pilot-to-production',
    '  conversion, usage-based pricing, data residency / sovereignty and RBI-style regulatory objections in Indian',
    '  enterprises, working alongside solution and forward-deployed engineers, GSI/SI partner motions, and comfort with',
    '  startup ambiguity. Bring this in where it genuinely applies.',
    '- Use Indian business context and ₹ / crore / lakh when talking money unless the source uses another currency.',
    `- When ${name} shares a setback (a rejection, a bad interview, a low day): acknowledge it plainly first, as a friend`,
    '  would; separate what was in their control from what was not; take one lesson; name one next move. No toxic',
    '  positivity, no lecture.',
    '',
    `## About ${name}`,
    profileContext(p),
    memory.length
      ? `\n## What you remember about ${name} (your own notes from earlier conversations)\n${memory.map((m) => `- [${m.id.slice(0, 8)}] ${m.text}`).join('\n')}`
      : ''
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

// ---------- Coach memory ----------

export function remember(text: string): CoachMemory {
  const m: CoachMemory = { id: newId(), text: text.trim().slice(0, 400), at: nowIso() }
  update<CoachMemory[]>('memory', [], (list) => [...list, m].slice(-60))
  return m
}

export function forget(idPrefix: string): boolean {
  let removed = false
  update<CoachMemory[]>('memory', [], (list) => list.filter((m) => {
    const hit = m.id.startsWith(idPrefix.trim())
    removed ||= hit
    return !hit
  }))
  return removed
}

const MEMORY_TOOLS: CoachTool[] = [
  {
    name: 'remember',
    description:
      'Save a short note about the candidate that will matter in future coaching sessions: a goal, a priority company, ' +
      'an upcoming interview and its date, a fear or recurring weak spot, a preference about how they want to be coached, ' +
      'or a personal constraint (notice period, location, compensation floor). One fact per call, written in the third ' +
      'person, under 30 words. Do not save trivia, anything already in your notes, or anything they ask you not to keep.',
    inputSchema: { type: 'object', properties: { note: { type: 'string', description: 'The fact to remember.' } }, required: ['note'] },
    validate: z.object({ note: z.string().min(3) }),
    run: (input: { note: string }) => { const m = remember(input.note); return `Saved as ${m.id.slice(0, 8)}.` }
  },
  {
    name: 'forget',
    description: 'Delete one of your saved notes that is outdated or wrong, using the 8-character id shown in your notes.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'The note id, e.g. 1a2b3c4d.' } }, required: ['id'] },
    validate: z.object({ id: z.string().min(4) }),
    run: (input: { id: string }) => (forget(input.id) ? 'Deleted.' : 'No note with that id.')
  }
]

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
      q.critique ? `Your previous critique of an earlier draft scored it ${q.critique.score}/100: "${q.critique.verdict}"` : '',
      '',
      'The candidate’s own written answer:',
      answer,
      '',
      'Critique it as a demanding senior interviewer. Score 0–100. Give a one-line verdict (if there was a previous',
      'critique, say plainly whether this draft is better and why), the real strengths, and specific fixes (quote the weak',
      'phrasing and show the better version). Then give a tightened rewrite that keeps their facts and voice — do not add',
      'facts they did not provide.'
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
      'business and products, the role’s scope, and any gaps between the candidate’s background and the job. Use categories',
      'from: Story & motivation, Deal execution, Numbers & forecasting, Team leadership, Strategy, GTM & P&L,',
      'Stakeholders & influence, Behavioural, AI & tech GTM, Company-specific. For each, say what the panel is really testing.'
    ].join('\n')
  })
  // Enum constraints aren't enforced by the output schema, so normalise here.
  return out.questions.map((q) => {
    const tracks = q.tracks.map((t) => t.toLowerCase().trim()).filter((t): t is Track => t === 'ic' || t === 'leader')
    return { ...q, tracks: tracks.length ? [...new Set(tracks)] : ['ic', 'leader'] }
  })
}

// ---------- Practice feedback ----------

function earlierAttempts(previous: PracticeAttempt[]): string {
  const scored = previous.filter((p) => p.feedback).slice(-3)
  if (!scored.length) return 'This is their first scored attempt at this question.'
  return [
    'Their earlier attempts at this same question (oldest first):',
    ...scored.map((p) => {
      const f = p.feedback!
      const m = p.metrics
      return `- ${p.createdAt.slice(0, 10)}: ${f.overall}/100 (structure ${f.scores.structure}, substance ${f.scores.substance}, ` +
        `presence ${f.scores.executivePresence}, delivery ${f.scores.delivery}, confidence ${f.scores.confidence}); ` +
        `${m.wpm} wpm, ${m.fillerCount} fillers, ${Math.round(m.durationSec)}s. Top fix then: ${f.fixes[0]?.issue ?? '—'}`
    })
  ].join('\n')
}

export async function practiceFeedback(opts: {
  question: Question
  transcript: string
  metrics: DeliveryMetrics
  mode: 'audio' | 'video'
  frames: string[]
  previous: PracticeAttempt[]
}): Promise<PracticeFeedback> {
  const { question, transcript, metrics, mode, frames, previous } = opts
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
      earlierAttempts(previous),
      '',
      'Coach this attempt like a VP-level panel member debriefing a candidate they want to win. Score each dimension',
      '0–10 (bodyLanguage only for video, from eye contact, posture, expression and energy in the frames; otherwise null)',
      'and give an overall 0–100.',
      '',
      'Benchmarks for the metrics: 130–160 words per minute is confident. More than 3 fillers per minute or frequent hedges',
      '("I think", "kind of", "maybe") undercut executive presence. Answers over ~2.5 minutes lose the room. airtimePct is',
      'the share of the recording spent speaking — under ~65% means long silences. startLatencySec over ~3s reads as',
      'hesitation. uptalkRate is the share of statements that rise in pitch at the end — above ~0.3 makes statements sound',
      'like questions. energyDropPct above ~35 means their voice fades toward the end (conviction draining away).',
      'paceShiftWpm above ~+25 means they sped up in the second half (often nerves). Pitch variation under ~1.5 semitones',
      'reads as monotone. trailingOffRate is the share of sentences whose last word drops in volume.',
      '',
      'Also read how they came across emotionally — their tone, not just their words: the three words a panel would use',
      '(e.g. assured, warm, rushed, guarded, flat, anxious, energised), how much nervousness showed, and their energy.',
      'Tie that read to evidence from the metrics, transcript and frames, and give one practical fix for their tone.',
      '',
      'Quote their actual words as evidence for each fix. Write the "power answer": how they should have said it — their',
      'facts, their voice, tighter and more senior. Give one specific drill for the next attempt. Say honestly whether',
      'this answer would get them to the next round. If there were earlier attempts, say in one line what improved and',
      'what did not (with numbers); otherwise leave progress empty. Finally, one line of genuine, evidence-based',
      'encouragement — something true about what they can build on.'
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
      presence: z.object({
        comesAcrossAs: z.array(z.string()).describe('Three words a panel would use for how they came across'),
        nerves: z.string().describe('Exactly one of: "calm", "some", "high"'),
        energy: z.string().describe('Exactly one of: "flat", "steady", "animated"'),
        read: z.string().describe('Two or three sentences on their tone and emotional presence, with evidence'),
        fix: z.string().describe('One practical fix for how they sound')
      }),
      strengths: z.array(z.string()),
      fixes: z.array(z.object({ issue: z.string(), evidence: z.string(), fix: z.string() })),
      powerAnswer: z.string(),
      drill: z.string(),
      progress: z.string().describe('Empty string if this is the first scored attempt'),
      belief: z.string()
    }),
    content
  })
  const w = out.wouldAdvance.toLowerCase()
  const n = out.presence.nerves.toLowerCase()
  const e = out.presence.energy.toLowerCase()
  return {
    ...out,
    wouldAdvance: w.startsWith('y') ? 'yes' : w.startsWith('n') ? 'no' : 'borderline',
    presence: {
      ...out.presence,
      comesAcrossAs: out.presence.comesAcrossAs.slice(0, 3),
      nerves: n.startsWith('h') ? 'high' : n.startsWith('c') ? 'calm' : 'some',
      energy: e.startsWith('f') ? 'flat' : e.startsWith('a') ? 'animated' : 'steady'
    },
    progress: out.progress.trim() || undefined
  }
}

// ---------- Mock interviews ----------

function metricLine(m: DeliveryMetrics): string {
  const perMin = m.durationSec > 0 ? (m.fillerCount / (m.durationSec / 60)).toFixed(1) : '0'
  return [
    `${Math.round(m.durationSec)}s`, `${m.wpm} wpm`, `${perMin} fillers/min`, `${m.hedgeCount} hedges`,
    m.airtimePct != null ? `airtime ${m.airtimePct}%` : '',
    m.startLatencySec != null ? `first word after ${m.startLatencySec}s` : '',
    m.uptalkRate != null ? `uptalk ${Math.round(m.uptalkRate * 100)}%` : '',
    m.energyDropPct != null ? `energy fade ${m.energyDropPct}%` : '',
    m.paceShiftWpm != null ? `pace drift ${m.paceShiftWpm > 0 ? '+' : ''}${m.paceShiftWpm} wpm` : '',
    m.pitchVariationSemitones != null ? `pitch variation ${m.pitchVariationSemitones} st` : ''
  ].filter(Boolean).join(', ')
}

// The interviewer is a panel member, not the coach: it probes, it doesn't encourage.
function panelSystem(app?: Application): string {
  const p = read<Profile>('profile', {} as Profile)
  const cvs = read<CvVersion[]>('cvs', [])
  const master = cvs.find((c) => c.id === p.masterCvId) ?? cvs.find((c) => c.kind === 'master') ?? cvs[0]
  return [
    app
      ? `You are a senior member of ${app.company}'s hiring panel, interviewing a candidate for ${app.role}.`
      : 'You are a senior member of the hiring panel at an AI-first technology company, interviewing a candidate for a senior enterprise sales role in India.',
    'You are sharp, fair and time-conscious. You listen for specifics — numbers, the candidate’s own role versus the',
    'team’s, how they handled resistance, what they would do differently — and you probe what was vague or too good to',
    'be true. You are not their coach and you give no feedback during the interview.',
    app?.jd ? `\nThe job description:\n${app.jd.slice(0, 10000)}` : '',
    master ? `\nThe candidate’s CV:\n${master.text.slice(0, 20000)}` : ''
  ].filter(Boolean).join('\n')
}

export async function mockFollowUp(turn: { question: string; transcript: string }, app?: Application): Promise<string | null> {
  const out = await coachParse('mock: follow-up', {
    system: panelSystem(app),
    effort: 'low',
    maxTokens: 2000,
    schema: z.object({ followUp: z.string() }),
    content: [
      `You asked: "${turn.question}"`,
      '',
      'Their answer (live speech-to-text, so ignore small transcription slips):',
      turn.transcript,
      '',
      'Would a sharp panel member probe before moving on? If the answer left a claim vague, a number missing, their',
      'personal contribution unclear, or invites an obvious challenge, ask ONE follow-up question — under 25 words, in',
      'natural spoken English, the way you would say it across the table. If the answer was complete and specific,',
      'return an empty string.'
    ].join('\n')
  })
  const q = out.followUp.trim()
  return q.length > 8 ? q : null
}

const DECISIONS = ['strong-yes', 'yes', 'lean-no', 'no'] as const

export async function mockDebrief(
  session: MockSession,
  app: Application | undefined,
  frames: (string | null)[],
  previous: MockSession[]
): Promise<MockDebrief> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [{
    type: 'text',
    text: [
      app ? `Mock interview for ${app.role} at ${app.company}.` : 'Mock interview: an AI-first company’s panel for a senior enterprise sales role in India.',
      app?.jd ? `Job description:\n${app.jd.slice(0, 8000)}` : '',
      '',
      'The full interview, in order (answers are local speech-to-text; it can miss "um/uh", so trust the delivery numbers):',
      ...session.turns.map((t, i) => [
        '',
        `Answer ${i + 1} — ${t.kind === 'followup' ? 'follow-up question' : 'question'}: "${t.question}"`,
        t.transcript.trim() || '(nothing was recognised — they may have skipped or stayed silent)',
        `Delivery: ${metricLine(t.metrics)}`
      ].join('\n')),
      session.planned.length > session.turns.filter((t) => t.kind === 'main').length
        ? `\n(They stopped after ${session.turns.filter((t) => t.kind === 'main').length} of ${session.planned.length} planned questions.)`
        : ''
    ].filter(Boolean).join('\n')
  }]
  const shots = frames.map((f, i) => [f, i] as const).filter(([f]) => f)
  if (shots.length) {
    content.push({ type: 'text', text: 'One still frame from the middle of each answer, labelled by answer number:' })
    for (const [f, i] of shots) {
      content.push({ type: 'text', text: `Answer ${i + 1}:` })
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: f! } })
    }
  }
  content.push({
    type: 'text',
    text: [
      previous.length
        ? `Their earlier mock interviews:\n${previous.map((m) => `- ${m.createdAt.slice(0, 10)} ${m.label}: ${m.debrief!.overall}/100, ${m.debrief!.decision.replace('-', ' ')}; patterns: ${m.debrief!.themes.join('; ')}`).join('\n')}`
        : 'This is their first mock interview.',
      '',
      'Debrief this interview in two voices. First as the hiring panel: on the evidence of this interview alone, would',
      'you advance them — strong yes, yes, lean no or no — with an overall 0–100 score, a one-line headline, and how the',
      'panel would actually talk about them in the debrief room. Then as their coach: for every answer, a 0–100 score, a',
      'one-line verdict, their single strongest sentence quoted verbatim (empty if none), and one fix. Name the real',
      'strengths, the 2–4 patterns that recur across answers, and their emotional presence across the interview — the',
      'three words a panel would use, nerves, energy, and how composure changed from the first answer to the last (did',
      'they warm up, or fade?), with one fix for how they sound. Then a three-step practice plan for before the next',
      'mock, one line on progress against earlier mocks (empty if this is the first), and one line of genuine,',
      'evidence-based belief.'
    ].join('\n')
  })
  const out = await coachParse('mock: debrief', {
    system: persona(),
    effort: 'high',
    schema: z.object({
      decision: z.string().describe('Exactly one of: "strong yes", "yes", "lean no", "no"'),
      overall: z.number().int(),
      headline: z.string(),
      summary: z.string().describe('How the panel would talk about the candidate in the debrief room, 3–4 sentences'),
      answers: z.array(z.object({
        turn: z.number().int().describe('Answer number, starting at 1'),
        score: z.number().int(),
        verdict: z.string(),
        bestLine: z.string().describe('Their strongest sentence, quoted verbatim; empty string if none'),
        fix: z.string()
      })),
      strengths: z.array(z.string()),
      themes: z.array(z.string()).describe('2–4 patterns that recur across answers'),
      presence: z.object({
        comesAcrossAs: z.array(z.string()),
        nerves: z.string().describe('Exactly one of: "calm", "some", "high"'),
        energy: z.string().describe('Exactly one of: "flat", "steady", "animated"'),
        read: z.string(),
        fix: z.string(),
        arc: z.string().describe('How composure and energy changed from the first answer to the last')
      }),
      plan: z.array(z.string()),
      progress: z.string(),
      belief: z.string()
    }),
    content
  })
  const d = out.decision.toLowerCase()
  const n = out.presence.nerves.toLowerCase()
  const e = out.presence.energy.toLowerCase()
  return {
    ...out,
    decision: d.startsWith('strong') ? DECISIONS[0] : d.includes('lean') ? DECISIONS[2] : d.startsWith('y') ? DECISIONS[1] : DECISIONS[3],
    presence: {
      ...out.presence,
      comesAcrossAs: out.presence.comesAcrossAs.slice(0, 3),
      nerves: n.startsWith('h') ? 'high' : n.startsWith('c') ? 'calm' : 'some',
      energy: e.startsWith('f') ? 'flat' : e.startsWith('a') ? 'animated' : 'steady'
    },
    progress: out.progress.trim() || undefined,
    at: nowIso()
  }
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
      'under an hour each), and a two- or three-sentence pep talk that is honest, personal and not cheesy.',
      'Read their mood check-in if there is one. On a low day (1–2), say so plainly and kindly, make the three tasks',
      'small confidence-builders, and remind them of one real win from their log. On a good day, push a little harder.',
      'On a Monday, open the pep talk with a one-line recap of last week.'
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
  const system = [
    persona(),
    '',
    '## This conversation',
    'This is your ongoing one-to-one chat — part coach, part trusted friend. Keep replies conversational and focused:',
    'answer what was asked, then offer one next step. Use the remember tool when they tell you something durable that',
    'will matter in future sessions, and forget when a note is outdated; do it quietly, without announcing it.'
  ].join('\n')
  return coachStream('coach: chat', { system, messages, onText, tools: MEMORY_TOOLS })
}
