import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { read, write, update, newId, nowIso, today } from './store'
import { getApiKey, hasApiKey, setApiKey } from './secrets'
import { applicationsDir, cvDir, deskRoot, ensure, practiceDir, safeName } from './paths'
import { monthSpend } from './ai'
import { runSweep, DEFAULT_EXCLUDE, DEFAULT_INCLUDE } from './engine/sweep'
import { importCvFile, markdownToDocx, markdownToPdf } from './documents'
import * as coach from './coach'
import { SEED_QUESTIONS } from './seeds'
import type {
  Application, AppStatus, ChatMessage, Company, CvVersion, DailyBrief, Job, PracticeAttempt,
  Profile, Question, Settings, SweepProgress, UsageEntry, BootstrapState, UsageSummary
} from '../shared/types'

const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  weeklyApplications: 5,
  weeklyPractice: 4,
  monthlyBudgetUsd: 20,
  aiMatching: true,
  includeKeywords: DEFAULT_INCLUDE,
  excludeKeywords: DEFAULT_EXCLUDE,
  indiaOnly: true
}
const DEFAULT_PROFILE: Profile = {
  name: '', headline: '', background: '',
  targetRoles: ['Enterprise Account Director', 'Head/Director/VP Enterprise Sales', 'National/Regional Sales Head', 'Country Manager / Business Head'],
  targetBrief: '', locations: 'India'
}

const settings = (): Settings => ({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>('settings', {}) })
const profile = (): Profile => ({ ...DEFAULT_PROFILE, ...read<Partial<Profile>>('profile', {}) })

function ensureQuestions(): Question[] {
  const existing = read<Question[] | null>('questions', null)
  if (existing) return existing
  return write('questions', SEED_QUESTIONS.map((s) => ({ ...s, id: newId(), readiness: 'new' as const, attempts: 0 })))
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
  if (!a[today()]) d.setDate(d.getDate() - 1)
  while (a[d.toISOString().slice(0, 10)]) { n++; d.setDate(d.getDate() - 1) }
  return n
}
function weekCount(kind: string): number {
  const a = read<Record<string, string[]>>('activity', {})
  const start = new Date()
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)) // Monday
  const from = start.toISOString().slice(0, 10)
  if (kind === 'apply') {
    return read<Application[]>('applications', []).filter((x) => x.appliedAt && x.appliedAt.slice(0, 10) >= from).length
  }
  if (kind === 'practice') {
    return read<PracticeAttempt[]>('practice', []).filter((x) => x.createdAt.slice(0, 10) >= from).length
  }
  return Object.entries(a).filter(([day, kinds]) => day >= from && kinds.includes(kind)).length
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

// Plain-text picture of the search, handed to the coach for briefs and chat.
function snapshot(): string {
  const apps = read<Application[]>('applications', [])
  const qs = ensureQuestions()
  const practice = read<PracticeAttempt[]>('practice', [])
  const jobs = read<Job[]>('jobs', []).filter((j) => j.relevant && !j.dismissed)
  const byStatus = (s: AppStatus): Application[] => apps.filter((a) => a.status === s)
  const active = apps.filter((a) => a.status !== 'closed')
  const staleApplied = byStatus('applied').filter((a) => a.appliedAt && Date.now() - new Date(a.appliedAt).getTime() > 7 * 864e5)
  const upcoming = active.filter((a) => a.nextStepDate).sort((x, y) => x.nextStepDate!.localeCompare(y.nextStepDate!))
  const ready = qs.filter((q) => q.readiness === 'ready').length
  const recent = practice.slice(-5).map((p) => `${p.createdAt.slice(0, 10)} "${p.questionText}" → ${p.feedback?.overall ?? '?'}/100${p.feedback ? `; top fix: ${p.feedback.fixes[0]?.issue ?? ''}` : ''}`)
  return [
    `Date: ${today()}. Streak: ${streak()} days. This week: ${weekCount('apply')} applications (goal ${settings().weeklyApplications}), ${weekCount('practice')} practice sessions (goal ${settings().weeklyPractice}).`,
    `Pipeline: ${['saved', 'applied', 'screening', 'interviewing', 'offer'].map((s) => `${s} ${byStatus(s as AppStatus).length}`).join(', ')}.`,
    active.length ? `Active applications:\n${active.slice(0, 25).map((a) => `- ${a.role} @ ${a.company} [${a.status}]${a.nextStep ? ` next: ${a.nextStep}${a.nextStepDate ? ` on ${a.nextStepDate}` : ''}` : ''}`).join('\n')}` : 'No active applications yet.',
    staleApplied.length ? `Applied 7+ days ago with no update (follow up?): ${staleApplied.map((a) => a.company).join(', ')}.` : '',
    upcoming.length ? `Upcoming: ${upcoming.slice(0, 5).map((a) => `${a.company} — ${a.nextStep} (${a.nextStepDate})`).join('; ')}.` : '',
    `Interview readiness: ${ready}/${qs.length} questions interview-ready; ${qs.filter((q) => q.myAnswer).length} have a written answer.`,
    recent.length ? `Recent practice:\n${recent.join('\n')}` : 'No practice recordings yet.',
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
    usage: usageSummary(),
    brief: read<DailyBrief | null>('brief', null),
    chat: read<ChatMessage[]>('chat', []),
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

  handle('state:get', () => bootstrap())
  handle('profile:save', (p: Profile) => write('profile', p))
  handle('settings:save', (s: Settings) => write('settings', s))
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
  handle('companies:add', (name: string, careersUrl?: string) => {
    const list = read<Company[]>('companies', [])
    const clean = name.trim()
    if (!clean) throw new Error('Enter a company name.')
    if (list.some((c) => c.name.toLowerCase() === clean.toLowerCase())) throw new Error(`${clean} is already on your list.`)
    const c: Company = { id: newId(), name: clean, careersUrl: careersUrl?.trim() || undefined, addedAt: nowIso() }
    write('companies', [...list, c])
    return c
  })
  handle('companies:update', (c: Company) => upsert('companies', c))
  handle('companies:remove', (id: string) => {
    remove('companies', id)
    update<Job[]>('jobs', [], (jobs) => jobs.filter((j) => j.companyId !== id))
  })
  let sweeping: Promise<SweepProgress> | null = null
  handle('jobs:sweep', () => {
    if (!sweeping) sweeping = runSweep((p) => send('sweep:progress', p)).finally(() => { sweeping = null })
    return sweeping
  })
  handle('jobs:dismiss', (id: string) => update<Job[]>('jobs', [], (jobs) => jobs.map((j) => (j.id === id ? { ...j, dismissed: true } : j))))
  handle('jobs:track', (jobId: string) => {
    const job = byId<Job>('jobs', jobId)
    const existing = read<Application[]>('applications', []).find((a) => a.jobId === jobId)
    if (existing) return existing
    const app: Application = {
      id: newId(), company: job.company, role: job.title, url: job.url, location: job.location,
      status: 'saved', jobId, createdAt: nowIso(), updatedAt: nowIso(), rounds: []
    }
    return upsert('applications', app)
  })

  // Applications
  handle('apps:save', (app: Application) => {
    const prev = read<Application[]>('applications', []).find((a) => a.id === app.id)
    const next = { ...app, updatedAt: nowIso(), rounds: app.rounds || [] }
    if (next.status !== 'saved' && !next.appliedAt) next.appliedAt = nowIso()
    if (prev && prev.status !== next.status) logActivity(next.status === 'applied' ? 'apply' : 'pipeline')
    if (!prev) logActivity('pipeline')
    return upsert('applications', next)
  })
  handle('apps:remove', (id: string) => remove('applications', id))
  handle('apps:openFolder', (id: string) => {
    const app = byId<Application>('applications', id)
    const folder = applicationFolder(app)
    if (app.folder !== folder) upsert('applications', { ...app, folder })
    return shell.openPath(folder)
  })
  // Lock the exact documents sent: CV (.docx + .pdf), cover letter, and the JD.
  handle('apps:lockPack', async (appId: string, cvId: string, letter?: string) => {
    const app = byId<Application>('applications', appId)
    const cv = byId<CvVersion>('cvs', cvId)
    const appliedAt = app.appliedAt || nowIso()
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
    upsert('cvs', { ...cv, locked: true, lockedAt: nowIso(), applicationId: app.id })
    logActivity('apply')
    return upsert('applications', {
      ...app, folder, appliedAt, cvVersionId: cv.id, coverLetter: letter || app.coverLetter,
      appliedFiles: files, status: app.status === 'saved' ? 'applied' : app.status, updatedAt: nowIso()
    })
  })

  // CVs
  handle('cvs:import', async () => {
    const win = getWindow()
    const pick = await dialog.showOpenDialog(win!, {
      title: 'Import a CV', properties: ['openFile'],
      filters: [{ name: 'CV', extensions: ['docx', 'pdf', 'txt', 'md'] }]
    })
    if (pick.canceled || !pick.filePaths[0]) return null
    const { text, storedCopy, name } = await importCvFile(pick.filePaths[0])
    const all = read<CvVersion[]>('cvs', [])
    const cv: CvVersion = {
      id: newId(), name, kind: all.some((c) => c.kind === 'master') ? 'working' : 'master',
      text, sourceFile: storedCopy, createdAt: nowIso(), updatedAt: nowIso()
    }
    if (cv.kind === 'master' && !profile().masterCvId) write('profile', { ...profile(), masterCvId: cv.id })
    return upsert('cvs', cv)
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
    upsert('applications', { ...app, cvVersionId: cv.id, updatedAt: nowIso() })
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
    if (prev && prev.readiness !== q.readiness && q.readiness === 'ready') logActivity('answer')
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
        attempt.feedback = await coach.practiceFeedback({ question: q, transcript: payload.transcript, metrics: payload.metrics, mode: payload.mode, frames: payload.frames })
        upsert('practice', attempt)
      } catch (e) {
        feedbackError = (e as Error).message
      }
    }
    const fresh = byId<Question>('questions', q.id)
    const score = attempt.feedback?.overall
    upsert('questions', {
      ...fresh, attempts: (fresh.attempts || 0) + 1,
      bestScore: score != null ? Math.max(score, fresh.bestScore ?? 0) : fresh.bestScore
    })
    return { ...attempt, words: [], feedbackError }
  })
  handle('practice:retryFeedback', async (id: string) => {
    const a = byId<PracticeAttempt>('practice', id)
    const q = byId<Question>('questions', a.questionId)
    a.feedback = await coach.practiceFeedback({ question: q, transcript: a.transcript, metrics: a.metrics, mode: 'audio', frames: [] })
    upsert('practice', a)
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

  // Coach
  handle('coach:brief', async (force?: boolean) => {
    const current = read<DailyBrief | null>('brief', null)
    if (current && current.day === today() && !force) return current
    const b = await coach.dailyBrief(snapshot())
    return write('brief', { day: today(), ...b })
  })
  handle('coach:chat', async (text: string) => {
    const history = [...read<ChatMessage[]>('chat', []), { role: 'user' as const, content: text, at: nowIso() }]
    write('chat', history)
    const reply = await coach.chat(history.slice(-30).map(({ role, content }) => ({ role, content })), snapshot(), (d) => send('coach:delta', d))
    return write('chat', [...history, { role: 'assistant' as const, content: reply, at: nowIso() }])
  })
  handle('coach:clear', () => write('chat', []))

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
