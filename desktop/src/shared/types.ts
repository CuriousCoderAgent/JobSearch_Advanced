// Data model shared by the main process (storage, AI) and the renderer (UI).

export type Track = 'ic' | 'leader'

// Calendar day in the PC's own time zone. toISOString() is UTC, which in India
// files anything done before 5:30am under the previous day.
export function localDay(d: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const ROLE_FOCUS = [
  'Enterprise Account Director',
  'Head/Director/VP Enterprise Sales',
  'National/Regional Sales Head',
  'Country Manager / Business Head',
  'Partnerships & Alliances Lead'
] as const
export type RoleFocus = (typeof ROLE_FOCUS)[number]

export interface Profile {
  name: string
  headline: string
  background: string
  targetRoles: RoleFocus[]
  targetBrief: string
  locations: string
  masterCvId?: string
}

export interface Settings {
  onboarded: boolean
  weeklyApplications: number
  weeklyPractice: number
  monthlyBudgetUsd: number
  aiMatching: boolean
  includeKeywords: string[]
  excludeKeywords: string[]
  indiaOnly: boolean
  autoSweep: boolean
  lastSweepAt?: string
  // Bumped when defaults (keywords, starter questions) change, so existing
  // installs pick up the new ones without losing anything they customised.
  dataVersion?: number
}

export type SourceType =
  | 'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters'
  | 'workday' | 'successfactors' | 'oracle' | 'amazon'
  | 'page' | 'portal' | 'none'

export interface CompanySource {
  type: SourceType
  slug?: string
  host?: string
  tenant?: string
  site?: string
  siteNumber?: string
  url?: string
  detectedAt: string
}

export interface Company {
  id: string
  name: string
  careersUrl?: string
  source?: CompanySource
  lastChecked?: string
  lastStatus?: string
  lastCount?: number
  pageHash?: string
  addedAt: string
}

export interface Job {
  id: string
  companyId: string
  company: string
  title: string
  url: string
  location: string
  postedAt?: string | null
  firstSeen: string
  lastSeen: string
  relevant: boolean | null
  relevanceReason?: string
  dismissed?: boolean
}

export type AppStatus = 'saved' | 'applied' | 'screening' | 'interviewing' | 'offer' | 'closed'
export const APP_STATUSES: { id: AppStatus; label: string }[] = [
  { id: 'saved', label: 'Saved' },
  { id: 'applied', label: 'Applied' },
  { id: 'screening', label: 'Screening' },
  { id: 'interviewing', label: 'Interviewing' },
  { id: 'offer', label: 'Offer' },
  { id: 'closed', label: 'Closed' }
]

export interface InterviewRound {
  id: string
  date: string
  stage: string
  interviewers: string
  notes: string
}

export interface Application {
  id: string
  company: string
  role: string
  url?: string
  location?: string
  status: AppStatus
  closedReason?: string
  jd?: string
  jobId?: string
  createdAt: string
  updatedAt: string
  appliedAt?: string
  nextStep?: string
  nextStepDate?: string
  notes?: string
  contacts?: string
  compensation?: string
  excitement?: number
  cvVersionId?: string
  coverLetter?: string
  folder?: string
  appliedFiles?: string[]
  rounds: InterviewRound[]
}

export type CvKind = 'master' | 'working' | 'tailored'
export interface CvVersion {
  id: string
  name: string
  kind: CvKind
  text: string
  createdAt: string
  updatedAt: string
  sourceFile?: string
  applicationId?: string
  basedOn?: string
  locked?: boolean
  lockedAt?: string
}

export type Readiness = 'new' | 'drafting' | 'polished' | 'ready'
export const READINESS: { id: Readiness; label: string }[] = [
  { id: 'new', label: 'Not started' },
  { id: 'drafting', label: 'Drafting' },
  { id: 'polished', label: 'Polished' },
  { id: 'ready', label: 'Interview-ready' }
]

export interface Critique {
  score: number
  verdict: string
  strengths: string[]
  fixes: string[]
  tightened: string
  at: string
}

export interface Question {
  id: string
  text: string
  category: string
  tracks: Track[]
  why?: string
  aiAnswer?: string
  aiAnswerAt?: string
  myAnswer?: string
  myAnswerUpdatedAt?: string
  critique?: Critique
  readiness: Readiness
  applicationId?: string
  custom?: boolean
  starred?: boolean
  attempts: number
  bestScore?: number
}

export interface WordStamp {
  text: string
  start: number
  end: number
}

export interface DeliveryMetrics {
  durationSec: number
  speakingSec: number
  wordCount: number
  wpm: number
  longPauses: number
  longestPauseSec: number
  fillerCount: number
  fillers: Record<string, number>
  hedgeCount: number
  hedges: Record<string, number>
  likelyFilledPauses: number
  pitchVariationSemitones: number | null
  trailingOffRate: number | null
  // Tone signals (added later; absent on older attempts).
  airtimePct?: number
  startLatencySec?: number
  uptalkRate?: number | null
  energyDropPct?: number | null
  paceShiftWpm?: number | null
}

export interface PresenceRead {
  comesAcrossAs: string[]
  nerves: 'calm' | 'some' | 'high'
  energy: 'flat' | 'steady' | 'animated'
  read: string
  fix: string
}

// ---------- Mock interviews ----------
// A full panel run: several questions back to back, optional follow-ups, and
// one debrief at the end instead of coaching after every answer.

export interface MockTurn {
  id: string
  kind: 'main' | 'followup'
  questionId?: string
  question: string
  at: string
  mediaFile?: string
  frameFile?: string
  transcript: string
  metrics: DeliveryMetrics
}

export type MockDecision = 'strong-yes' | 'yes' | 'lean-no' | 'no'

export interface MockAnswerReview {
  turn: number
  score: number
  verdict: string
  bestLine: string
  fix: string
}

export interface MockDebrief {
  decision: MockDecision
  overall: number
  headline: string
  summary: string
  answers: MockAnswerReview[]
  strengths: string[]
  themes: string[]
  presence: PresenceRead & { arc: string }
  plan: string[]
  progress?: string
  belief: string
  at: string
}

export interface MockSession {
  id: string
  createdAt: string
  applicationId?: string
  label: string
  mode: 'audio' | 'video'
  followUps: boolean
  planned: { questionId: string; text: string }[]
  turns: MockTurn[]
  debrief?: MockDebrief
}

export interface PracticeFeedback {
  overall: number
  verdict: string
  wouldAdvance: 'yes' | 'borderline' | 'no'
  scores: {
    structure: number
    substance: number
    executivePresence: number
    delivery: number
    confidence: number
    bodyLanguage: number | null
  }
  strengths: string[]
  fixes: { issue: string; evidence: string; fix: string }[]
  powerAnswer: string
  drill: string
  presence?: PresenceRead
  progress?: string
  belief?: string
}

export interface PracticeAttempt {
  id: string
  questionId: string
  questionText: string
  mode: 'audio' | 'video'
  createdAt: string
  mediaFile?: string
  transcript: string
  words: WordStamp[]
  metrics: DeliveryMetrics
  feedback?: PracticeFeedback
}

export interface UsageEntry {
  at: string
  feature: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheRead: number
  cacheWrite: number
  webSearches: number
  costUsd: number
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  at: string
}

export interface DailyBrief {
  day: string
  headline: string
  focus: string[]
  pepTalk: string
  moodAware?: boolean
}

export interface MoodEntry {
  day: string
  score: 1 | 2 | 3 | 4 | 5
  note?: string
  at: string
}

export interface Win {
  id: string
  at: string
  text: string
  auto: boolean
}

export interface CoachMemory {
  id: string
  text: string
  at: string
}

export interface SweepProgress {
  running: boolean
  done: number
  total: number
  current?: string
  newJobs?: number
  highlights?: string[]
  error?: string
}

export interface UsageSummary {
  month: string
  total: number
  byFeature: Record<string, number>
}

export interface BootstrapState {
  profile: Profile
  settings: Settings
  hasKey: boolean
  companies: Company[]
  jobs: Job[]
  applications: Application[]
  cvs: CvVersion[]
  questions: Question[]
  practice: PracticeAttempt[]
  mocks: MockSession[]
  usage: UsageSummary
  brief: DailyBrief | null
  chat: ChatMessage[]
  moods: MoodEntry[]
  wins: Win[]
  memory: CoachMemory[]
  today: string
  streak: number
  week: { applications: number; practice: number }
  deskRoot: string
}
