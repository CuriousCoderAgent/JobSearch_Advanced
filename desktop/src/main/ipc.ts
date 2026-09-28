import { BrowserWindow, Notification, dialog, ipcMain, shell } from 'electron'
import { existsSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { read, write, update, newId, nowIso, today } from './store'
import { getApiKey, hasApiKey, setApiKey } from './secrets'
import { applicationsDir, cvDir, deskRoot, ensure, practiceDir, safeName } from './paths'
import { costOf, monthSpend } from './ai'
import { runSweep, DEFAULT_EXCLUDE, DEFAULT_INCLUDE, EXCLUDE_ADDED_V2, INCLUDE_ADDED_V2 } from './engine/sweep'
import { getJobDescription } from './engine/jd'
import { importCvFile, markdownToDocx, markdownToPdf } from './documents'
import * as coach from './coach'
import { AI_GTM_QUESTIONS, SEED_QUESTIONS } from './seeds'
import {
  APP_STATUSES, localDay,
  type Application, type AppStatus, type ChatMessage, type CoachMemory, type Company, type CvVersion, type DailyBrief,
  type Job, type MockDecision, type MockSession, type MockTurn, type MoodEntry, type PracticeAttempt, type Profile,
  type Question, type Settings, type SweepProgress,
  type UsageEntry, type BootstrapState, type UsageSummary, type Win
} from '../shared/types'

const DATA_VERSION = 2
const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  weeklyApplications: 5,
  weeklyPractice: 4,
  monthlyBudgetUsd: 20,
  aiMatching: true,
  includeKeywords: DEFAULT_INCLUDE,
  excludeKeywords: DEFAULT_EXCLUDE,
  indiaOnly: true,
  autoSweep: true
}
const DEFAULT_PROFILE: Profile = {
  name: '', headline: '', background: '',
  targetRoles: ['Enterprise Account Director', 'Head/Director/VP Enterprise Sales', 'National/Regional Sales Head', 'Country Manager / Business Head'],
  targetBrief: '', locations: 'India'
}

const settings = (): Settings => ({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>('settings', {}) })
const profile = (): Profile => ({ ...DEFAULT_PROFILE, ...read<Partial<Profile>>('profile', {}) })

const seedToQuestion = (s: (typeof SEED_QUESTIONS)[number]): Question => ({ ...s, id: newId(), readiness: 'new', attempts: 0 })

function ensureQuestions(): Question[] {
  const existing = read<Question[] | null>('questions', null)
  if (existing) return existing
  return write('questions', SEED_QUESTIONS.map(seedToQuestion))
}

// One-time upgrades of an existing install's data when defaults change. Only
// ever adds; nothing you customised is removed.
function migrate(): void {
  const s = read<Partial<Settings>>('settings', {})
  if ((s.dataVersion ?? 1) >= DATA_VERSION) return

  // v2: AI-company job titles and interview questions.
  const next: Partial<Settings> = { ...s, dataVersion: DATA_VERSION }
  if (s.includeKeywords?.length) next.includeKeywords = [...new Set([...s.includeKeywords, ...INCLUDE_ADDED_V2])]
  if (s.excludeKeywords?.length) next.excludeKeywords = [...new Set([...s.excludeKeywords, ...EXCLUDE_ADDED_V2])]
  write('settings', next)
  // v2: dated model ids ("claude-haiku-4-5-20251001") were priced at Opus rates.
  update<UsageEntry[]>('usage', [], (list) => list.map((u) => ({ ...u, costUsd: costOf(u) })))
  const qs = read<Question[] | null>('questions', null)
  if (qs) {
    const have = new Set(qs.map((q) => q.text))
    const add = AI_GTM_QUESTIONS.filter((x) => !have.has(x.text)).map(seedToQuestion)
    if (add.length) write('questions', [...qs, ...add])
  }

  // v2: a master or working CV used to be locked when it was sent, which froze
  // the CV you keep improving. Give each application its own frozen copy and
  // unlock the original.
  const cvs = read<CvVersion[]>('cvs', [])
  const apps = read<Application[]>('applications', [])
  let changed = false
  for (const cv of [...cvs]) {
    if (!cv.locked || cv.kind === 'tailored') continue
    for (const app of apps.filter((a) => a.cvVersionId === cv.id && a.appliedFiles?.length)) {
      const copy: CvVersion = {
        ...cv, id: newId(), name: `Sent — ${app.company} — ${app.role}`, kind: 'tailored', basedOn: cv.id,
        applicationId: app.id, locked: true, lockedAt: cv.lockedAt || nowIso(), sourceFile: undefined
      }
      cvs.push(copy)
      app.cvVersionId = copy.id
    }
    Object.assign(cv, { locked: false, lockedAt: undefined, applicationId: undefined })
    changed = true
  }
  if (changed) { write('cvs', cvs); write('applications', apps) }
}

// Streak: any meaningful action (apply, practice, polish an answer, tailor a CV) marks the day.
function logActivity(kind: string): void {
  update<Record<string, string[]>>('activity', {}, (a) => {
    const day = today()
    return { ...a, [day]: [...new Set([...(a[day] || []), kind])] }
  })
}
function streak(): number {
  const a = read<Record<string, string[]>>('activity', {})
  let n = 0
  const d = new Date()
  if (!a[localDay(d)]) d.setDate(d.getDate() - 1)
  while (a[localDay(d)]) { n++; d.setDate(d.getDate() - 1) }
  return n
}
function weekStart(): string {
  const start = new Date()
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)) // Monday
  return localDay(start)
}
function weekCount(kind: string): number {
  const from = weekStart()
  if (kind === 'apply') {
    return read<Application[]>('applications', []).filter((x) => x.appliedAt && localDay(new Date(x.appliedAt)) >= from).length
  }
  if (kind === 'practice') {
    // A whole mock interview counts as one practice session.
    return read<PracticeAttempt[]>('practice', []).filter((x) => localDay(new Date(x.createdAt)) >= from).length +
      read<MockSession[]>('mocks', []).filter((m) => m.turns.length && localDay(new Date(m.createdAt)) >= from).length
  }
  const a = read<Record<string, string[]>>('activity', {})
  return Object.entries(a).filter(([day, kinds]) => day >= from && kinds.includes(kind)).length
}

// Wins: the evidence a coach reminds you of on a hard day. Most are logged
// automatically as you make progress; you can add your own too.
function addWin(text: string, auto = true): Win {
  const w: Win = { id: newId(), at: nowIso(), text, auto }
  update<Win[]>('wins', [], (list) => [...list, w].slice(-300))
  return w
}
const STAGE_ORDER: AppStatus[] = APP_STATUSES.map((s) => s.id)
function stageWin(app: Application, from: AppStatus | undefined): void {
  if (app.status === 'closed' || (from && STAGE_ORDER.indexOf(app.status) <= STAGE_ORDER.indexOf(from))) return
  const where = `${app.role} at ${app.company}`
  if (app.status === 'applied') addWin(`Applied for ${where}`)
  if (app.status === 'screening') addWin(`${app.company} came back — screening for ${app.role}`)
  if (app.status === 'interviewing') addWin(`Landed interviews for ${where}`)
  if (app.status === 'offer') addWin(`Offer: ${where}`)
}

function usageSummary(): UsageSummary {
  const month = new Date().toISOString().slice(0, 7)
  const byFeature: Record<string, number> = {}
  for (const u of read<UsageEntry[]>('usage', []).filter((x) => x.at.startsWith(month))) {
    const group = u.feature.split(':')[0]
    byFeature[group] = (byFeature[group] || 0) + u.costUsd
  }
  return { month, total: monthSpend(), byFeature }
}

const MOOD_WORDS = ['', 'rough', 'low', 'okay', 'good', 'great']
const DECISION_WORDS: Record<MockDecision, string> = { 'strong-yes': 'strong yes', yes: 'yes', 'lean-no': 'lean no', no: 'no' }

// Questions for a mock interview: an opener, the company-specific questions
// the coach predicted, what AI-first panels probe, one past weak spot, core
// commercial questions, and a closer. Recently asked ones go to the back.
const LEADER_ROLE = /\b(head|vp|vice president|director of|country|regional|national|general manager|business head|chief)\b/i
const CORE_CATEGORIES = ['Deal execution', 'Numbers & forecasting', 'Strategy, GTM & P&L', 'Team leadership', 'Stakeholders & influence', 'Behavioural']
function planMock(app: Application | undefined, count: number): Question[] {
  const qs = ensureQuestions()
  const track = app ? (LEADER_ROLE.test(app.role) ? 'leader' : 'ic') : null
  const recent = new Set(read<MockSession[]>('mocks', []).slice(0, 2).flatMap((m) => m.planned.map((p) => p.questionId)))
  const shuffled = (xs: Question[]): Question[] => xs
    .map((q) => [Math.random() + (recent.has(q.id) ? 1 : 0), q] as const)
    .sort((a, b) => a[0] - b[0])
    .map(([, q]) => q)
  const general = (pred: (q: Question) => boolean): Question[] =>
    shuffled(qs.filter((q) => !q.applicationId && (!track || q.tracks.includes(track)) && pred(q)))
  const picked: Question[] = []
  const closer = qs.find((q) => q.text === 'Why should we pick you over the other finalists?')
  const body = closer ? count - 1 : count
  const add = (q: Question | undefined): void => { if (q && picked.length < body && !picked.some((p) => p.id === q.id)) picked.push(q) }
  add(qs.find((q) => q.text === 'Walk me through your career so far.'))
  if (app) add(qs.find((q) => q.text === 'Why this company, and why this role?'))
  if (app) shuffled(qs.filter((q) => q.applicationId === app.id)).slice(0, Math.ceil(count / 2)).forEach(add)
  general((q) => q.category === 'AI & tech GTM').slice(0, count >= 5 ? 2 : 1).forEach(add)
  general((q) => (q.bestScore != null && q.bestScore < 60) || (q.critique != null && q.critique.score < 60)).slice(0, 1).forEach(add)
  general((q) => CORE_CATEGORIES.includes(q.category)).forEach(add)
  if (closer) picked.push(closer)
  return picked
}

// Plain-text picture of the search, handed to the coach for briefs and chat.
function snapshot(): string {
  const apps = read<Application[]>('applications', [])
  const qs = ensureQuestions()
  const practice = read<PracticeAttempt[]>('practice', [])
  const jobs = read<Job[]>('jobs', []).filter((j) => j.relevant && !j.dismissed)
  const moods = read<MoodEntry[]>('moods', [])
  const wins = read<Win[]>('wins', [])
  const byStatus = (s: AppStatus): Application[] => apps.filter((a) => a.status === s)
  const active = apps.filter((a) => a.status !== 'closed')
  const staleApplied = byStatus('applied').filter((a) => a.appliedAt && Date.now() - new Date(a.appliedAt).getTime() > 7 * 864e5)
  const upcoming = active.filter((a) => a.nextStepDate).sort((x, y) => x.nextStepDate!.localeCompare(y.nextStepDate!))
  const closedRecently = byStatus('closed').filter((a) => Date.now() - new Date(a.updatedAt).getTime() < 14 * 864e5)
  const ready = qs.filter((q) => q.readiness === 'ready').length
  const recent = practice.slice(-5).map((p) => `${p.createdAt.slice(0, 10)} "${p.questionText}" → ${p.feedback?.overall ?? '?'}/100${p.feedback ? `; top fix: ${p.feedback.fixes[0]?.issue ?? ''}` : ''}`)
  const mocks = read<MockSession[]>('mocks', []).filter((m) => m.debrief).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-3)
  const todayMood = moods.find((m) => m.day === today())
  const week = moods.filter((m) => Date.now() - new Date(m.at).getTime() < 7 * 864e5)
  const recentWins = wins.filter((w) => Date.now() - new Date(w.at).getTime() < 21 * 864e5).slice(-10)
  const s = settings()
  return [
    `Date: ${today()} (${new Date().toLocaleDateString('en-IN', { weekday: 'long' })}). Streak: ${streak()} days. This week: ${weekCount('apply')} applications (goal ${s.weeklyApplications}), ${weekCount('practice')} practice sessions (goal ${s.weeklyPractice}).`,
    todayMood
      ? `Today's check-in: feeling ${MOOD_WORDS[todayMood.score]} (${todayMood.score}/5)${todayMood.note ? ` — in their words: "${todayMood.note}"` : ''}.`
      : 'No mood check-in today.',
    week.length > 1 ? `Mood over the last week: ${week.map((m) => `${m.day.slice(5)} ${m.score}/5`).join(', ')}.` : '',
    `Pipeline: ${['saved', 'applied', 'screening', 'interviewing', 'offer'].map((st) => `${st} ${byStatus(st as AppStatus).length}`).join(', ')}.`,
    active.length ? `Active applications:\n${active.slice(0, 25).map((a) => `- ${a.role} @ ${a.company} [${a.status}]${a.nextStep ? ` next: ${a.nextStep}${a.nextStepDate ? ` on ${a.nextStepDate}` : ''}` : ''}`).join('\n')}` : 'No active applications yet.',
    closedRecently.length ? `Closed in the last two weeks: ${closedRecently.map((a) => `${a.company} (${a.closedReason || 'closed'})`).join(', ')}.` : '',
    staleApplied.length ? `Applied 7+ days ago with no update (follow up?): ${staleApplied.map((a) => a.company).join(', ')}.` : '',
    upcoming.length ? `Upcoming: ${upcoming.slice(0, 5).map((a) => `${a.company} — ${a.nextStep} (${a.nextStepDate})`).join('; ')}.` : '',
    `Interview readiness: ${ready}/${qs.length} questions interview-ready; ${qs.filter((q) => q.myAnswer).length} have a written answer.`,
    recent.length ? `Recent practice:\n${recent.join('\n')}` : 'No practice recordings yet.',
    mocks.length
      ? `Mock interviews:\n${mocks.map((m) => `- ${m.createdAt.slice(0, 10)} ${m.label}: ${m.debrief!.overall}/100, panel says ${DECISION_WORDS[m.debrief!.decision]}; patterns: ${m.debrief!.themes.slice(0, 2).join('; ')}`).join('\n')}`
      : '',
    recentWins.length ? `Wins logged in the last three weeks:\n${recentWins.map((w) => `- ${w.at.slice(0, 10)}: ${w.text}`).join('\n')}` : 'No wins logged yet.',
    `New relevant job openings on the radar: ${jobs.filter((j) => Date.now() - new Date(j.firstSeen).getTime() < 3 * 864e5).length} in the last 3 days.`
  ].filter(Boolean).join('\n')
}

function bootstrap(): BootstrapState {
  return {
    profile: profile(),
    settings: settings(),
    hasKey: hasApiKey(),
    companies: read<Company[]>('companies', []),
    jobs: read<Job[]>('jobs', []).filter((j) => j.relevant && !j.dismissed),
    applications: read<Application[]>('applications', []),
    cvs: read<CvVersion[]>('cvs', []),
    questions: ensureQuestions(),
    practice: read<PracticeAttempt[]>('practice', []).map(({ words: _w, ...p }) => ({ ...p, words: [] })),
    mocks: read<MockSession[]>('mocks', []),
    usage: usageSummary(),
    brief: read<DailyBrief | null>('brief', null),
    chat: read<ChatMessage[]>('chat', []),
    moods: read<MoodEntry[]>('moods', []).slice(-60),
    wins: read<Win[]>('wins', []).slice(-100),
    memory: read<CoachMemory[]>('memory', []),
    today: today(),
    streak: streak(),
    week: { applications: weekCount('apply'), practice: weekCount('practice') },
    deskRoot: deskRoot()
  }
}

function upsert<T extends { id: string }>(name: string, item: T): T {
  update<T[]>(name, [], (list) => {
    const i = list.findIndex((x) => x.id === item.id)
    return i >= 0 ? list.map((x) => (x.id === item.id ? item : x)) : [item, ...list]
  })
  return item
}
function remove(name: string, id: string): void {
  update<{ id: string }[]>(name, [], (list) => list.filter((x) => x.id !== id))
}
function byId<T extends { id: string }>(name: string, id: string): T {
  const found = read<T[]>(name, []).find((x) => x.id === id)
  if (!found) throw new Error('That item no longer exists.')
  return found
}

function applicationFolder(app: Application): string {
  if (app.folder && existsSync(app.folder)) return app.folder
  const day = (app.appliedAt || nowIso()).slice(0, 10)
  return ensure(join(applicationsDir(), safeName(`${app.company} - ${app.role} (${day})`, 110)))
}

// Explorer-friendly index of every application pack: which CV went where.
function writeRegister(): void {
  const apps = read<Application[]>('applications', []).filter((a) => a.appliedFiles?.length)
  const cvs = read<CvVersion[]>('cvs', [])
  const cell = (v: string | undefined): string => `"${(v ?? '').replace(/"/g, '""')}"`
  const rows = apps
    .sort((a, b) => (b.appliedAt || '').localeCompare(a.appliedAt || ''))
    .map((a) => {
      const cv = cvs.find((c) => c.id === a.cvVersionId)
      const based = cv?.basedOn ? cvs.find((c) => c.id === cv.basedOn)?.name : ''
      return [a.appliedAt?.slice(0, 10), a.company, a.role, APP_STATUSES.find((s) => s.id === a.status)?.label, cv?.name, based, a.folder, a.url].map(cell).join(',')
    })
  try {
    writeFileSync(join(applicationsDir(), 'CV register.csv'),
      '﻿' + ['Sent on,Company,Role,Status,CV sent,Built from,Folder,Job link', ...rows].join('\r\n'), 'utf8')
  } catch { /* open in Excel — rewritten next time */ }
}

type Handler = (...args: any[]) => unknown // eslint-disable-line @typescript-eslint/no-explicit-any
function handle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) }
    } catch (err) {
      return { ok: false, error: (err as Error).message || String(err) }
    }
  })
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const send = (channel: string, payload: unknown): void => getWindow()?.webContents.send(channel, payload)
  migrate()

  const showWindow = (page?: string, focus?: string): void => {
    const w = getWindow()
    if (!w) return
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
    if (page) send('nav', { page, focus })
  }
  const notify = (title: string, body: string, page?: string, focus?: string): void => {
    if (!Notification.isSupported()) return
    const n = new Notification({ title, body })
    n.on('click', () => showWindow(page, focus))
    n.show()
  }

  handle('state:get', () => bootstrap())
  handle('profile:save', (p: Profile) => write('profile', p))
  handle('settings:save', (s: Settings) => {
    // The sweep and migrations own these; a page holding older state mustn't roll them back.
    const stored = read<Partial<Settings>>('settings', {})
    return write('settings', { ...s, lastSweepAt: stored.lastSweepAt, dataVersion: stored.dataVersion })
  })
  handle('key:set', (key: string) => { setApiKey(key); return hasApiKey() })
  handle('key:test', async () => {
    const key = getApiKey()
    if (!key) throw new Error('No key saved.')
    const res = await fetch('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } })
    if (!res.ok) throw new Error(res.status === 401 ? 'That key was rejected by Anthropic.' : `Anthropic returned ${res.status}.`)
    return true
  })
  handle('usage:get', () => usageSummary())

  // Companies & jobs
  const addCompany = (name: string, careersUrl?: string): Company => {
    const list = read<Company[]>('companies', [])
    const clean = name.trim()
    if (!clean) throw new Error('Enter a company name.')
    if (list.some((c) => c.name.toLowerCase() === clean.toLowerCase())) throw new Error(`${clean} is already on your list.`)
    const c: Company = { id: newId(), name: clean, careersUrl: careersUrl?.trim() || undefined, addedAt: nowIso() }
    write('companies', [...list, c])
    return c
  }
  handle('companies:add', (name: string, careersUrl?: string) => addCompany(name, careersUrl))
  handle('companies:addMany', (names: string[]) => {
    const have = new Set(read<Company[]>('companies', []).map((c) => c.name.toLowerCase()))
    return names.filter((n) => n.trim() && !have.has(n.trim().toLowerCase())).map((n) => addCompany(n))
  })
  handle('companies:update', (c: Company) => upsert('companies', c))
  handle('companies:remove', (id: string) => {
    remove('companies', id)
    update<Job[]>('jobs', [], (jobs) => jobs.filter((j) => j.companyId !== id))
  })

  let sweeping: Promise<SweepProgress> | null = null
  const sweep = (): Promise<SweepProgress> => {
    if (!sweeping) sweeping = runSweep((p) => send('sweep:progress', p)).finally(() => { sweeping = null })
    return sweeping
  }
  handle('jobs:sweep', () => sweep())

  // Background radar: sweep when the last one is over 12 hours old, and nudge
  // about interviews coming up. Checked shortly after launch, then every 30 min.
  const tick = async (): Promise<void> => {
    const s = settings()
    if (!s.onboarded) return
    const nudged = read<Record<string, string>>('nudges', {})
    for (const a of read<Application[]>('applications', [])) {
      if (a.status === 'closed' || !a.nextStepDate) continue
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
      const when = a.nextStepDate === today() ? 'Today' : a.nextStepDate === localDay(tomorrow) ? 'Tomorrow' : null
      const key = `${a.id}:${a.nextStepDate}:${when}`
      if (!when || nudged[key]) continue
      notify(`${when}: ${a.company}`, `${a.nextStep || 'Next step'} — ${a.role}. A 20-minute run through your prep will pay off.`, 'applications', a.id)
      update<Record<string, string>>('nudges', {}, (n) => ({ ...n, [key]: nowIso() }))
    }
    const stale = !s.lastSweepAt || Date.now() - new Date(s.lastSweepAt).getTime() > 12 * 3600e3
    if (!s.autoSweep || !stale || sweeping || !read<Company[]>('companies', []).length) return
    try {
      const r = await sweep()
      if (r.newJobs) {
        notify(`${r.newJobs} new role${r.newJobs === 1 ? '' : 's'} on your radar`, (r.highlights || []).join('\n'), 'jobs')
      }
    } catch { /* tried again at the next tick */ }
  }
  setTimeout(() => { tick() }, 20_000)
  setInterval(() => { tick() }, 30 * 60_000)

  handle('jobs:dismiss', (id: string) => update<Job[]>('jobs', [], (jobs) => jobs.map((j) => (j.id === id ? { ...j, dismissed: true } : j))))
  handle('jobs:track', (jobId: string) => {
    const job = byId<Job>('jobs', jobId)
    const existing = read<Application[]>('applications', []).find((a) => a.jobId === jobId)
    if (existing) return existing
    const app: Application = {
      id: newId(), company: job.company, role: job.title, url: job.url, location: job.location,
      status: 'saved', jobId, createdAt: nowIso(), updatedAt: nowIso(), rounds: []
    }
    upsert('applications', app)
    logActivity('pipeline')
    // Pull the full job description in the background; the card updates when it lands.
    const company = read<Company[]>('companies', []).find((c) => c.id === job.companyId)
    getJobDescription(job.url, { source: company?.source, externalId: job.id.slice(job.companyId.length + 1) })
      .then((jd) => {
        if (!jd) return
        const fresh = read<Application[]>('applications', []).find((a) => a.id === app.id)
        if (fresh && !fresh.jd?.trim()) send('app:updated', upsert('applications', { ...fresh, jd, updatedAt: nowIso() }))
      })
      .catch(() => { /* the Fetch button in the application retries */ })
    return app
  })

  // Applications
  handle('apps:save', (app: Application) => {
    const prev = read<Application[]>('applications', []).find((a) => a.id === app.id)
    const next = { ...app, updatedAt: nowIso(), rounds: app.rounds || [] }
    if (next.status !== 'saved' && next.status !== 'closed' && !next.appliedAt) next.appliedAt = nowIso()
    if (prev && prev.status !== next.status) {
      logActivity(next.status === 'applied' ? 'apply' : 'pipeline')
      stageWin(next, prev.status)
    }
    if (!prev) { logActivity('pipeline'); if (next.status !== 'saved') stageWin(next, undefined) }
    const saved = upsert('applications', next)
    if (saved.appliedFiles?.length) writeRegister()
    return saved
  })
  handle('apps:remove', (id: string) => remove('applications', id))
  handle('apps:fetchJd', async (id: string) => {
    const app = byId<Application>('applications', id)
    if (!app.url) throw new Error('Add the job link first.')
    const job = app.jobId ? read<Job[]>('jobs', []).find((j) => j.id === app.jobId) : undefined
    const company = job ? read<Company[]>('companies', []).find((c) => c.id === job.companyId) : undefined
    const jd = await getJobDescription(app.url, job && company ? { source: company.source, externalId: job.id.slice(job.companyId.length + 1) } : {})
    if (!jd) throw new Error('Couldn’t read a job description from that link — paste it in instead.')
    return upsert('applications', { ...byId<Application>('applications', id), jd, updatedAt: nowIso() })
  })
  handle('apps:openFolder', (id: string) => {
    const app = byId<Application>('applications', id)
    const folder = applicationFolder(app)
    if (app.folder !== folder) upsert('applications', { ...app, folder })
    return shell.openPath(folder)
  })
  // Lock the exact documents sent: CV (.docx + .pdf), cover letter, and the JD.
  handle('apps:lockPack', async (appId: string, cvId: string, letter?: string) => {
    const app = byId<Application>('applications', appId)
    let cv = byId<CvVersion>('cvs', cvId)
    const appliedAt = app.appliedAt || nowIso()
    // Each application keeps its own frozen copy of the CV that went out. A
    // CV tailored for this job is frozen as-is; anything else (your master, a
    // working draft, another job's version) is copied, so it stays editable.
    const ownTailored = cv.kind === 'tailored' && (cv.applicationId === app.id || (!cv.applicationId && !cv.locked))
    cv = ownTailored
      ? upsert('cvs', { ...cv, locked: true, lockedAt: cv.lockedAt || nowIso(), applicationId: app.id })
      : upsert('cvs', {
        ...cv, id: newId(), name: `Sent — ${app.company} — ${app.role}`, kind: 'tailored' as const, basedOn: cv.id,
        applicationId: app.id, locked: true, lockedAt: nowIso(), sourceFile: undefined, createdAt: nowIso(), updatedAt: nowIso()
      })
    const folder = applicationFolder({ ...app, appliedAt })
    const who = safeName(profile().name || 'CV', 40)
    const stem = safeName(`CV - ${who} - ${app.company}`, 90)
    const files = [
      await markdownToDocx(cv.text, join(folder, `${stem}.docx`)),
      await markdownToPdf(cv.text, join(folder, `${stem}.pdf`))
    ]
    if (letter?.trim()) files.push(await markdownToDocx(letter, join(folder, safeName(`Cover letter - ${app.company}`, 90) + '.docx')))
    if (app.jd?.trim()) {
      const jdFile = join(folder, 'Job description.txt')
      writeFileSync(jdFile, `${app.role} — ${app.company}\n${app.url || ''}\nSaved ${appliedAt.slice(0, 10)}\n\n${app.jd}`, 'utf8')
      files.push(jdFile)
    }
    logActivity('apply')
    if (app.status === 'saved') stageWin({ ...app, status: 'applied' }, 'saved')
    const saved = upsert('applications', {
      ...app, folder, appliedAt, cvVersionId: cv.id, coverLetter: letter || app.coverLetter,
      appliedFiles: files, status: app.status === 'saved' ? 'applied' : app.status, updatedAt: nowIso()
    })
    writeRegister()
    return { app: saved, cv }
  })

  // CVs
  const importOne = async (file: string, all: CvVersion[]): Promise<CvVersion> => {
    const { text, storedCopy, name } = await importCvFile(file)
    const cv: CvVersion = {
      id: newId(), name, kind: all.some((c) => c.kind === 'master') ? 'working' : 'master',
      text, sourceFile: storedCopy, createdAt: nowIso(), updatedAt: nowIso()
    }
    if (cv.kind === 'master' && !profile().masterCvId) write('profile', { ...profile(), masterCvId: cv.id })
    all.push(cv)
    return upsert('cvs', cv)
  }
  handle('cvs:import', async () => {
    const pick = await dialog.showOpenDialog(getWindow()!, {
      title: 'Import a CV', properties: ['openFile'],
      filters: [{ name: 'CV', extensions: ['docx', 'pdf', 'txt', 'md'] }]
    })
    if (pick.canceled || !pick.filePaths[0]) return null
    return importOne(pick.filePaths[0], read<CvVersion[]>('cvs', []))
  })
  // Bring in a whole folder of old versions at once; bad files are skipped.
  handle('cvs:importMany', async () => {
    const pick = await dialog.showOpenDialog(getWindow()!, {
      title: 'Import CV versions', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'CV', extensions: ['docx', 'pdf', 'txt', 'md'] }]
    })
    if (pick.canceled || !pick.filePaths.length) return { imported: [], failed: [] }
    const all = [...read<CvVersion[]>('cvs', [])]
    const imported: CvVersion[] = []
    const failed: string[] = []
    for (const f of pick.filePaths) {
      try { imported.push(await importOne(f, all)) } catch { failed.push(f.split(/[\\/]/).pop() || f) }
    }
    return { imported, failed }
  })
  handle('cvs:save', (cv: CvVersion) => {
    const prev = read<CvVersion[]>('cvs', []).find((c) => c.id === cv.id)
    if (prev?.locked && prev.text !== cv.text) throw new Error('This version was sent to an employer and is locked. Duplicate it to edit.')
    return upsert('cvs', { ...cv, updatedAt: nowIso() })
  })
  handle('cvs:duplicate', (id: string) => {
    const cv = byId<CvVersion>('cvs', id)
    return upsert('cvs', {
      ...cv, id: newId(), name: `${cv.name} (copy)`, kind: 'working', locked: false, lockedAt: undefined,
      applicationId: undefined, basedOn: cv.id, createdAt: nowIso(), updatedAt: nowIso()
    })
  })
  handle('cvs:remove', (id: string) => {
    const cv = byId<CvVersion>('cvs', id)
    if (cv.locked) throw new Error('This version was sent to an employer — keep it for your records.')
    remove('cvs', id)
  })
  handle('cvs:tailor', async (cvId: string, appId: string) => {
    const base = byId<CvVersion>('cvs', cvId)
    const app = byId<Application>('applications', appId)
    const out = await coach.tailorCv(base, app)
    logActivity('tailor')
    const cv = upsert('cvs', {
      id: newId(), name: `${app.company} — ${app.role}`, kind: 'tailored' as const, text: out.cv,
      applicationId: app.id, basedOn: base.id, createdAt: nowIso(), updatedAt: nowIso()
    })
    upsert('applications', { ...byId<Application>('applications', appId), cvVersionId: cv.id, updatedAt: nowIso() })
    return { cv, changes: out.changes, keywordsMatched: out.keywordsMatched, gaps: out.gaps }
  })
  handle('cvs:coverLetter', async (cvId: string, appId: string) => {
    const letter = await coach.coverLetter(byId<CvVersion>('cvs', cvId), byId<Application>('applications', appId))
    const app = byId<Application>('applications', appId)
    upsert('applications', { ...app, coverLetter: letter, updatedAt: nowIso() })
    return letter
  })
  handle('cvs:export', async (id: string, format: 'docx' | 'pdf') => {
    const cv = byId<CvVersion>('cvs', id)
    const pick = await dialog.showSaveDialog(getWindow()!, {
      defaultPath: join(cvDir(), `${safeName(cv.name, 80)}.${format}`),
      filters: [{ name: format.toUpperCase(), extensions: [format] }]
    })
    if (pick.canceled || !pick.filePath) return null
    const file = format === 'docx' ? await markdownToDocx(cv.text, pick.filePath) : await markdownToPdf(cv.text, pick.filePath)
    shell.showItemInFolder(file)
    return file
  })

  // Interview prep
  handle('prep:save', (q: Question) => {
    const prev = read<Question[]>('questions', []).find((x) => x.id === q.id)
    if (prev && q.myAnswer !== prev.myAnswer) { q.myAnswerUpdatedAt = nowIso(); logActivity('answer') }
    if (prev && prev.readiness !== q.readiness && q.readiness === 'ready') {
      logActivity('answer')
      addWin(`Made “${q.text}” interview-ready`)
    }
    return upsert('questions', q)
  })
  handle('prep:add', (text: string, category: string, tracks: Question['tracks']) =>
    upsert('questions', { id: newId(), text, category: category || 'My questions', tracks, readiness: 'new', attempts: 0, custom: true } as Question))
  handle('prep:remove', (id: string) => remove('questions', id))
  handle('prep:modelAnswer', async (id: string) => {
    const q = byId<Question>('questions', id)
    const app = q.applicationId ? read<Application[]>('applications', []).find((a) => a.id === q.applicationId) : undefined
    const aiAnswer = await coach.modelAnswer(q, app)
    return upsert('questions', { ...byId<Question>('questions', id), aiAnswer, aiAnswerAt: nowIso() })
  })
  handle('prep:critique', async (id: string) => {
    const q = byId<Question>('questions', id)
    if (!q.myAnswer?.trim()) throw new Error('Write your answer first, then ask for a critique.')
    const c = await coach.critiqueAnswer(q, q.myAnswer)
    const fresh = byId<Question>('questions', id)
    const readiness = fresh.readiness === 'new' ? 'drafting' : fresh.readiness
    if (fresh.critique && c.score >= fresh.critique.score + 10) addWin(`Written answer to “${q.text}” up from ${fresh.critique.score} to ${c.score}`)
    return upsert('questions', { ...fresh, readiness, critique: { ...c, at: nowIso() } })
  })
  handle('prep:generateForApp', async (appId: string) => {
    const app = byId<Application>('applications', appId)
    const generated = await coach.questionsForJob(app)
    const created: Question[] = generated.map((g) => ({
      id: newId(), text: g.text, category: g.category, tracks: g.tracks.length ? g.tracks : ['ic', 'leader'],
      why: g.why, readiness: 'new', attempts: 0, applicationId: app.id
    }))
    update<Question[]>('questions', [], (list) => [...created, ...list])
    return created
  })

  // Practice
  const previousAttempts = (questionId: string, exceptId: string): PracticeAttempt[] =>
    read<PracticeAttempt[]>('practice', [])
      .filter((p) => p.questionId === questionId && p.id !== exceptId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const practiceWin = (q: Question, score: number | undefined, prevBest: number | undefined): void => {
    if (score == null) return
    if (prevBest != null && score >= prevBest + 5) addWin(`Spoken answer to “${q.text}” up from ${prevBest} to ${score}`)
    else if (prevBest == null && score >= 70) addWin(`Scored ${score} first time on “${q.text}”`)
  }
  handle('practice:save', async (payload: {
    questionId: string; mode: 'audio' | 'video'; media: ArrayBuffer; ext: string
    transcript: string; words: PracticeAttempt['words']; metrics: PracticeAttempt['metrics']; frames: string[]
  }) => {
    const q = byId<Question>('questions', payload.questionId)
    const id = newId()
    const mediaFile = join(practiceDir(), `${today()} - ${safeName(q.text, 50)} - ${id.slice(0, 6)}.${payload.ext}`)
    writeFileSync(mediaFile, Buffer.from(payload.media))
    const attempt: PracticeAttempt = {
      id, questionId: q.id, questionText: q.text, mode: payload.mode, createdAt: nowIso(), mediaFile,
      transcript: payload.transcript, words: payload.words, metrics: payload.metrics
    }
    upsert('practice', attempt)
    logActivity('practice')
    // The recording is safe on disk either way; a failed review can be retried.
    let feedbackError: string | undefined
    if (hasApiKey()) {
      try {
        attempt.feedback = await coach.practiceFeedback({
          question: q, transcript: payload.transcript, metrics: payload.metrics, mode: payload.mode, frames: payload.frames,
          previous: previousAttempts(q.id, id)
        })
        upsert('practice', attempt)
      } catch (e) {
        feedbackError = (e as Error).message
      }
    }
    const fresh = byId<Question>('questions', q.id)
    const score = attempt.feedback?.overall
    practiceWin(q, score, fresh.bestScore)
    upsert('questions', {
      ...fresh, attempts: (fresh.attempts || 0) + 1,
      bestScore: score != null ? Math.max(score, fresh.bestScore ?? 0) : fresh.bestScore
    })
    return { ...attempt, words: [], feedbackError }
  })
  handle('practice:retryFeedback', async (id: string) => {
    const a = byId<PracticeAttempt>('practice', id)
    const q = byId<Question>('questions', a.questionId)
    // Still frames aren't kept after the first review, so a retry is voice-only.
    a.feedback = await coach.practiceFeedback({
      question: q, transcript: a.transcript, metrics: a.metrics, mode: 'audio', frames: [], previous: previousAttempts(q.id, a.id)
    })
    upsert('practice', a)
    const fresh = byId<Question>('questions', q.id)
    practiceWin(q, a.feedback.overall, fresh.bestScore)
    upsert('questions', { ...fresh, bestScore: Math.max(a.feedback.overall, fresh.bestScore ?? 0) })
    return { ...a, words: [] }
  })
  handle('practice:remove', (id: string) => {
    const a = read<PracticeAttempt[]>('practice', []).find((x) => x.id === id)
    if (a?.mediaFile && existsSync(a.mediaFile)) unlinkSync(a.mediaFile)
    remove('practice', id)
  })
  handle('practice:mediaUrl', (id: string) => {
    const a = byId<PracticeAttempt>('practice', id)
    return a.mediaFile && existsSync(a.mediaFile) ? `media://${encodeURIComponent(a.mediaFile)}` : null
  })

  // Mock interviews
  const mockApp = (s: MockSession): Application | undefined =>
    s.applicationId ? read<Application[]>('applications', []).find((a) => a.id === s.applicationId) : undefined
  handle('mock:start', (appId: string | null, count: number, mode: 'audio' | 'video', followUps: boolean) => {
    const app = appId ? byId<Application>('applications', appId) : undefined
    const planned = planMock(app, Math.min(8, Math.max(2, Math.round(count))))
    if (!planned.length) throw new Error('No questions to ask yet — add some in Interview Prep.')
    return upsert<MockSession>('mocks', {
      id: newId(), createdAt: nowIso(), applicationId: app?.id,
      label: app ? `${app.company} — ${app.role}` : 'AI-company panel',
      mode, followUps: followUps && hasApiKey(),
      planned: planned.map((q) => ({ questionId: q.id, text: q.text })), turns: []
    })
  })
  handle('mock:turn', (sessionId: string, p: {
    kind: MockTurn['kind']; questionId?: string; question: string; media: ArrayBuffer; ext: string
    transcript: string; metrics: MockTurn['metrics']; frame?: string
  }) => {
    const s = byId<MockSession>('mocks', sessionId)
    const dir = ensure(join(practiceDir(), 'Mock interviews', safeName(`${s.createdAt.slice(0, 10)} - ${s.label} - ${s.id.slice(0, 6)}`, 110)))
    const stem = `${String(s.turns.length + 1).padStart(2, '0')} - ${safeName(p.question, 50)}`
    const mediaFile = join(dir, `${stem}.${p.ext}`)
    writeFileSync(mediaFile, Buffer.from(p.media))
    let frameFile: string | undefined
    if (p.frame) { frameFile = join(dir, `${stem}.jpg`); writeFileSync(frameFile, Buffer.from(p.frame, 'base64')) }
    const turn: MockTurn = {
      id: newId(), kind: p.kind, questionId: p.questionId, question: p.question, at: nowIso(),
      mediaFile, frameFile, transcript: p.transcript, metrics: p.metrics
    }
    const fresh = byId<MockSession>('mocks', sessionId)
    upsert('mocks', { ...fresh, turns: [...fresh.turns, turn] })
    logActivity('practice')
    return turn
  })
  // One probing follow-up after a main answer, at most one for every two questions.
  handle('mock:followUp', async (sessionId: string, turnId: string) => {
    const s = byId<MockSession>('mocks', sessionId)
    if (!s.followUps || !hasApiKey()) return null
    if (s.turns.filter((t) => t.kind === 'followup').length >= Math.ceil(s.planned.length / 2)) return null
    const turn = s.turns.find((t) => t.id === turnId)
    if (!turn || turn.kind !== 'main' || turn.transcript.trim().split(/\s+/).length < 12) return null
    return coach.mockFollowUp(turn, mockApp(s))
  })
  handle('mock:debrief', async (sessionId: string) => {
    const s = byId<MockSession>('mocks', sessionId)
    if (!s.turns.length) throw new Error('Answer at least one question first.')
    const frames = s.mode === 'video'
      ? s.turns.map((t) => (t.frameFile && existsSync(t.frameFile) ? readFileSync(t.frameFile).toString('base64') : null))
      : []
    const previous = read<MockSession[]>('mocks', [])
      .filter((m) => m.id !== s.id && m.debrief && m.createdAt < s.createdAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-2)
    const debrief = await coach.mockDebrief(s, mockApp(s), frames, previous)
    if (!s.debrief) {
      // Sitting it is the win; the verdict only joins the log when it's a good one.
      const advanced = debrief.decision === 'yes' || debrief.decision === 'strong-yes'
      addWin(`Sat a ${s.turns.length}-answer mock interview (${s.label})${advanced ? ` — the panel would advance you (${debrief.overall})` : ''}`)
      const last = previous[previous.length - 1]?.debrief
      if (last && debrief.overall >= last.overall + 5) addWin(`Mock interview score up from ${last.overall} to ${debrief.overall}`)
    }
    return upsert('mocks', { ...byId<MockSession>('mocks', sessionId), debrief })
  })
  handle('mock:remove', (sessionId: string) => {
    const s = read<MockSession[]>('mocks', []).find((m) => m.id === sessionId)
    for (const t of s?.turns ?? []) {
      for (const f of [t.mediaFile, t.frameFile]) if (f && existsSync(f)) unlinkSync(f)
    }
    const dir = s?.turns[0]?.mediaFile ? dirname(s.turns[0].mediaFile) : null
    if (dir && existsSync(dir) && !readdirSync(dir).length) rmdirSync(dir)
    remove('mocks', sessionId)
  })
  handle('mock:mediaUrl', (sessionId: string, turnId: string) => {
    const t = byId<MockSession>('mocks', sessionId).turns.find((x) => x.id === turnId)
    return t?.mediaFile && existsSync(t.mediaFile) ? `media://${encodeURIComponent(t.mediaFile)}` : null
  })

  // Coach
  handle('coach:brief', async (force?: boolean) => {
    const current = read<DailyBrief | null>('brief', null)
    if (current && current.day === today() && !force) return current
    const b = await coach.dailyBrief(snapshot())
    const moodAware = read<MoodEntry[]>('moods', []).some((m) => m.day === today())
    return write('brief', { day: today(), ...b, moodAware })
  })
  handle('coach:chat', async (text: string) => {
    const history = [...read<ChatMessage[]>('chat', []), { role: 'user' as const, content: text, at: nowIso() }]
    write('chat', history)
    const reply = await coach.chat(history.slice(-30).map(({ role, content }) => ({ role, content })), snapshot(), (d) => send('coach:delta', d))
    return { chat: write('chat', [...history, { role: 'assistant' as const, content: reply, at: nowIso() }]), memory: read<CoachMemory[]>('memory', []) }
  })
  handle('coach:clear', () => write('chat', []))
  handle('memory:add', (text: string) => {
    if (!text.trim()) throw new Error('Write something for your coach to remember.')
    coach.remember(text)
    return read<CoachMemory[]>('memory', [])
  })
  handle('memory:remove', (id: string) => { coach.forget(id); return read<CoachMemory[]>('memory', []) })

  // Mood & wins
  handle('mood:set', (score: number, note?: string) => {
    const entry: MoodEntry = {
      day: today(), score: Math.min(5, Math.max(1, Math.round(score))) as MoodEntry['score'], note: note?.trim() || undefined, at: nowIso()
    }
    update<MoodEntry[]>('moods', [], (list) => [...list.filter((m) => m.day !== entry.day), entry].slice(-365))
    return entry
  })
  handle('wins:add', (text: string) => {
    if (!text.trim()) throw new Error('Describe the win first.')
    return addWin(text.trim(), false)
  })
  handle('wins:remove', (id: string) => remove('wins', id))

  // One-time import from the JobRadar web app (companies, tracker, profile).
  handle('import:jobradar', async (baseUrl: string, username: string, password: string) => {
    const base = baseUrl.replace(/\/+$/, '')
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password })
    })
    const lj = await login.json().catch(() => ({}))
    if (!login.ok) throw new Error(lj.error || `Login failed (${login.status}).`)
    const get = async (path: string): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await fetch(`${base}${path}`, { headers: { 'x-session': lj.token } })
      return r.ok ? r.json() : {}
    }
    const [c, a, s] = await Promise.all([get('/api/companies'), get('/api/applications'), get('/api/settings')])
    const companies = read<Company[]>('companies', [])
    let addedCompanies = 0
    for (const rc of c.companies || []) {
      if (companies.some((x) => x.name.toLowerCase() === String(rc.name).toLowerCase())) continue
      companies.push({ id: newId(), name: rc.name, careersUrl: rc.careersUrl, addedAt: nowIso() })
      addedCompanies++
    }
    write('companies', companies)
    const apps = read<Application[]>('applications', [])
    let addedApps = 0
    const statusMap: Record<string, AppStatus> = { saved: 'saved', applied: 'applied', interviewing: 'interviewing', offer: 'offer', rejected: 'closed' }
    for (const ra of a.applications || []) {
      if (apps.some((x) => x.url && x.url === ra.url)) continue
      apps.push({
        id: newId(), company: ra.company, role: ra.title, url: ra.url, location: ra.location,
        status: statusMap[ra.status] || 'saved', closedReason: ra.status === 'rejected' ? 'Rejected' : undefined,
        createdAt: ra.addedAt || nowIso(), updatedAt: nowIso(), appliedAt: ra.status !== 'saved' ? ra.addedAt : undefined, rounds: []
      })
      addedApps++
    }
    write('applications', apps)
    const p = profile()
    if (s.settings) {
      write('profile', {
        ...p,
        background: p.background || s.settings.profile || '',
        targetBrief: p.targetBrief || s.settings.targetRoles || ''
      })
    }
    return { addedCompanies, addedApps }
  })

  handle('shell:openPath', (p: string) => shell.openPath(p))
  handle('shell:openExternal', (url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only web links can be opened.')
    return shell.openExternal(url)
  })
}
