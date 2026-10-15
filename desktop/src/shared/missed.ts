import type { Application, Job } from './types'

// Matching roles that closed before he applied, and what that pattern costs.
// Shared by the Jobs page and the coach's picture of the search.

const DAY = 864e5
const daysBetween = (a: string, b: string | number): number =>
  Math.max(0, ((typeof b === 'number' ? b : new Date(b).getTime()) - new Date(a).getTime()) / DAY)

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const norm = (s: string | undefined): string => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** His application for a listing — by job id, then link, then company + title. */
export function appFor(job: Job, apps: Application[]): Application | undefined {
  return apps.find((a) => a.jobId === job.id) ||
    apps.find((a) => !!a.url && a.url === job.url) ||
    apps.find((a) => norm(a.company) === norm(job.company) && norm(a.role) === norm(job.title))
}

/** Counts as acted on: applied (or further), or deliberately closed. Saving alone doesn't. */
export const actedOn = (a: Application | undefined): boolean => !!a && (a.status !== 'saved' || !!a.appliedAt)

/** Days the role was visibly open to him: from when the radar first showed it to when it was last seen live. */
export const openDays = (j: Job): number => daysBetween(j.firstSeen, j.lastSeen)

export interface MissedRole {
  job: Job
  /** Set when he saved it to the tracker but never applied. */
  saved?: Application
  openDays: number
}

export interface MissedSummary {
  missed: MissedRole[]
  last30: number
  savedNotApplied: number
  /** Matching roles that closed, missed or not (the denominator for the catch rate). */
  closedTotal: number
  /** Closed matching roles he did apply to. */
  caught: number
  /** How long matching roles stay up, in days (closed roles only). */
  medianOpenDays: number | null
  /** His own time from a role appearing on the radar to applying, in days. */
  medianApplyDays: number | null
  /** Share of his applications that got past the application stage, when there are enough to say. */
  responseRate: { rate: number; of: number } | null
  byCompany: { company: string; count: number }[]
  /** Live matches he hasn't acted on, oldest first, that are getting on in age. */
  atRisk: { job: Job; openDays: number }[]
}

export function missedSummary(jobs: Job[], apps: Application[], now = Date.now()): MissedSummary {
  const matching = jobs.filter((j) => j.relevant && !j.dismissed)
  const closed = matching.filter((j) => j.goneAt)
  const missed: MissedRole[] = []
  let caught = 0
  for (const j of closed) {
    const a = appFor(j, apps)
    if (actedOn(a)) { caught++; continue }
    missed.push({ job: j, saved: a, openDays: openDays(j) })
  }
  missed.sort((x, y) => y.job.goneAt!.localeCompare(x.job.goneAt!))

  const applyDays = apps
    .filter((a) => a.appliedAt && a.jobId)
    .map((a) => {
      const j = jobs.find((x) => x.id === a.jobId)
      return j ? daysBetween(j.firstSeen, a.appliedAt!) : null
    })
    .filter((d): d is number => d != null)

  const applied = apps.filter((a) => a.appliedAt)
  const advanced = applied.filter((a) => ['screening', 'interviewing', 'offer'].includes(a.status) || a.rounds?.length)

  const counts = new Map<string, number>()
  for (const m of missed) counts.set(m.job.company, (counts.get(m.job.company) ?? 0) + 1)

  const window = median(closed.map(openDays))
  const riskAfter = Math.max(5, Math.round((window ?? 14) * 0.5))
  const atRisk = matching
    .filter((j) => !j.goneAt && !actedOn(appFor(j, apps)))
    .map((j) => ({ job: j, openDays: daysBetween(j.firstSeen, now) }))
    .filter((r) => r.openDays >= riskAfter)
    .sort((a, b) => b.openDays - a.openDays)

  return {
    missed,
    last30: missed.filter((m) => daysBetween(m.job.goneAt!, now) <= 30).length,
    savedNotApplied: missed.filter((m) => m.saved).length,
    closedTotal: closed.length,
    caught,
    medianOpenDays: window,
    medianApplyDays: median(applyDays),
    responseRate: applied.length >= 3 ? { rate: advanced.length / applied.length, of: applied.length } : null,
    byCompany: [...counts].map(([company, count]) => ({ company, count })).sort((a, b) => b.count - a.count),
    atRisk
  }
}

export const fmtDays = (d: number): string => (d < 1 ? 'under a day' : `${Math.round(d)} day${Math.round(d) === 1 ? '' : 's'}`)
