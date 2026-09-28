import { createHash } from 'crypto'
import { z } from 'zod'
import type { Company, Job, Profile, Settings, SweepProgress } from '../../shared/types'
import { read, write, nowIso } from '../store'
import { hasApiKey } from '../secrets'
import { bulkParse } from '../ai'
import { discoverSource } from './discover'
import { fetchFromSource, getText, type RawJob } from './adapters'

export const DEFAULT_INCLUDE = [
  'sales', 'account director', 'account executive', 'account manager', 'business development',
  'country manager', 'country head', 'general manager', 'business head', 'revenue', 'go-to-market', 'gtm',
  'commercial', 'key account', 'strategic accounts', 'enterprise account', 'enterprise sales', 'enterprise business',
  'alliances', 'partnerships',
  'regional head', 'zonal head', 'cluster head', 'channel'
]
export const DEFAULT_EXCLUDE = [
  'intern', 'internship', 'fresher', 'trainee', 'apprentice', 'sales development representative',
  'business development representative', 'sdr', 'bdr', 'sales associate', 'telecaller',
  'engineer', 'engineering', 'architect', 'developer', 'scientist', 'designer', 'recruiter', 'analyst', 'operations'
]
const INDIA_RE = /\b(india|bangalore|bengaluru|mumbai|bombay|delhi|ncr|gurgaon|gurugram|hyderabad|pune|chennai|noida|kolkata|ahmedabad|kochi|jaipur|chandigarh)\b/i
// "Remote" on its own counts; "Remote - California" does not.
const ANYWHERE = '\\b(remote|anywhere|worldwide|global|work from home|wfh)\\b'
export function isIndiaOrAnywhere(location: string): boolean {
  if (!location.trim() || INDIA_RE.test(location) || /\bIND\b/.test(location)) return true
  return new RegExp(ANYWHERE, 'i').test(location) && !location.replace(new RegExp(ANYWHERE, 'gi'), '').replace(/[^a-z]/gi, '')
}
const REDISCOVER_DAYS: Record<string, number> = { none: 14, portal: 14, page: 30 }

const wordRe = (terms: string[]): RegExp | null =>
  terms.length ? new RegExp(`\\b(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i') : null

function daysSince(iso?: string): number {
  return iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : Infinity
}

// Search phrases for big-company feeds (Workday, SuccessFactors, Oracle, Amazon).
function searchQueries(profile: Profile): string[] {
  const q = new Set<string>(['enterprise sales', 'sales director'])
  for (const r of profile.targetRoles || []) {
    if (r.startsWith('Enterprise Account')) q.add('account director')
    if (r.startsWith('Head/Director/VP')) q.add('head of sales')
    if (r.startsWith('National/Regional')) q.add('regional sales')
    if (r.startsWith('Country Manager')) q.add('country manager')
  }
  return [...q].slice(0, 5)
}

async function readCareersPage(company: Company, url: string): Promise<{ jobs: RawJob[] | null; hash?: string; unchanged?: boolean }> {
  const html = await getText(url, 15000)
  if (!html) return { jobs: null }
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>/gi, ' [LINK:$1] ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 40000)
  const hash = createHash('sha1').update(text).digest('hex')
  if (hash === company.pageHash) return { jobs: null, hash, unchanged: true }
  if (!hasApiKey()) return { jobs: null, hash }
  const schema = z.object({
    jobs: z.array(z.object({ title: z.string(), url: z.string().nullable(), location: z.string().nullable() }))
  })
  const out = await bulkParse('jobs: read careers page', {
    system:
      'You extract open job postings from careers-page text. Only include real, currently listed job postings. ' +
      'For each, take the URL from the nearest [LINK:...] marker if there is one. If there are none, return an empty list.',
    content: `Page URL: ${url}\n\nPage text:\n${text}`,
    schema
  })
  const jobs = out.jobs.slice(0, 150).map((j) => {
    let link = j.url || url
    try { link = new URL(link, url).href } catch { link = url }
    return {
      externalId: `pg-${createHash('sha1').update(`${j.title}|${j.location || ''}`).digest('hex').slice(0, 16)}`,
      title: j.title, url: link, location: j.location || '', postedAt: null
    }
  })
  return { jobs, hash }
}

async function judgeRelevance(candidates: Job[], profile: Profile): Promise<Map<string, string | null>> {
  const verdicts = new Map<string, string | null>()
  const schema = z.object({ keep: z.array(z.object({ index: z.number().int(), reason: z.string() })) })
  const wants = [
    `Target roles: ${(profile.targetRoles || []).join('; ') || 'senior enterprise sales roles'}`,
    profile.targetBrief ? `In their words: ${profile.targetBrief}` : '',
    profile.headline ? `Current: ${profile.headline}` : '',
    profile.locations ? `Locations: ${profile.locations}` : ''
  ].filter(Boolean).join('\n')
  for (let i = 0; i < candidates.length; i += 80) {
    const chunk = candidates.slice(i, i + 80)
    const listing = chunk.map((j, n) => `${n}. ${j.title} — ${j.company}${j.location ? ` (${j.location})` : ''}`).join('\n')
    const out = await bulkParse('jobs: judge relevance', {
      system:
        'You screen job listings for one senior candidate. Keep a role only if they would plausibly apply: right function ' +
        '(enterprise / B2B sales and sales leadership, including senior individual-contributor account roles) and right ' +
        'seniority (director-level individual contributor or above, or a leadership role). Be generous with title wording, ' +
        'strict about function and level. Give a short reason for each kept role.',
      content: `${wants}\n\nListings:\n${listing}`,
      schema,
      maxTokens: 4000
    })
    for (const j of chunk) verdicts.set(j.id, null)
    for (const k of out.keep) if (chunk[k.index]) verdicts.set(chunk[k.index].id, k.reason)
  }
  return verdicts
}

export async function runSweep(onProgress: (p: SweepProgress) => void): Promise<SweepProgress> {
  const companies = read<Company[]>('companies', [])
  const settings = read<Settings>('settings', {} as Settings)
  const profile = read<Profile>('profile', {} as Profile)
  const existing = new Map(read<Job[]>('jobs', []).map((j) => [j.id, j]))
  const include = wordRe(settings.includeKeywords?.length ? settings.includeKeywords : DEFAULT_INCLUDE)
  const exclude = wordRe(settings.excludeKeywords?.length ? settings.excludeKeywords : DEFAULT_EXCLUDE)
  const queries = searchQueries(profile)
  const now = nowIso()
  const progress: SweepProgress = { running: true, done: 0, total: companies.length }
  onProgress({ ...progress })

  const fresh: Job[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < companies.length) {
      const c = companies[next++]
      onProgress({ ...progress, current: c.name })
      try {
        const stale = !c.source || daysSince(c.source.detectedAt) > (REDISCOVER_DAYS[c.source.type] ?? 365)
        if (stale) c.source = await discoverSource(c, hasApiKey())
        const src = c.source!
        let raw: RawJob[] | null = null
        if (src.type === 'page' && src.url) {
          const r = await readCareersPage(c, src.url)
          if (r.hash) c.pageHash = r.hash
          if (r.unchanged) {
            for (const j of existing.values()) if (j.companyId === c.id) j.lastSeen = now
            c.lastStatus = 'Careers page unchanged — no AI needed'
          } else raw = r.jobs
        } else {
          raw = await fetchFromSource(src, queries, settings.indiaOnly !== false)
          // A known feed that stops answering is re-discovered next time.
          if (!raw && !['portal', 'none'].includes(src.type)) c.source = { ...src, detectedAt: '1970-01-01T00:00:00.000Z' }
        }
        if (raw) {
          for (const r of raw) {
            const id = `${c.id}:${r.externalId}`
            const prev = existing.get(id)
            if (prev) { prev.lastSeen = now; prev.title = r.title; prev.url = r.url; prev.location = r.location }
            else {
              const job: Job = {
                id, companyId: c.id, company: c.name, title: r.title, url: r.url, location: r.location,
                postedAt: r.postedAt ?? null, firstSeen: now, lastSeen: now, relevant: null
              }
              existing.set(id, job)
              fresh.push(job)
            }
          }
          c.lastCount = raw.length
          c.lastStatus = `${raw.length} open roles via ${src.type}`
        } else if (src.type === 'portal') c.lastStatus = 'Uses a portal we can’t read — check manually'
        else if (src.type === 'none') c.lastStatus = 'No careers feed found — add a careers URL'
        else if (!c.lastStatus?.includes('unchanged')) c.lastStatus = `Could not read ${src.type} feed this time`
      } catch (e) {
        c.lastStatus = `Error: ${(e as Error).message}`.slice(0, 140)
      }
      c.lastChecked = now
      progress.done++
      onProgress({ ...progress })
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, companies.length) }, worker))

  // Free prefilter first; AI only ever sees brand-new listings that pass it.
  const indiaOnly = settings.indiaOnly !== false
  const toJudge: Job[] = []
  for (const j of fresh) {
    if (exclude?.test(j.title)) { j.relevant = false; j.relevanceReason = 'Excluded keyword'; continue }
    if (include && !include.test(j.title)) { j.relevant = false; j.relevanceReason = 'Not a sales role'; continue }
    if (indiaOnly && !isIndiaOrAnywhere(j.location)) { j.relevant = false; j.relevanceReason = 'Outside India'; continue }
    toJudge.push(j)
  }
  if (toJudge.length && settings.aiMatching !== false && hasApiKey()) {
    try {
      const verdicts = await judgeRelevance(toJudge, profile)
      for (const j of toJudge) {
        const reason = verdicts.get(j.id)
        j.relevant = reason != null
        j.relevanceReason = reason ?? 'Judged not a fit for your level/function'
      }
    } catch (e) {
      for (const j of toJudge) { j.relevant = true; j.relevanceReason = 'Keyword match (AI check unavailable)' }
      progress.error = (e as Error).message
    }
  } else {
    for (const j of toJudge) { j.relevant = true; j.relevanceReason = 'Keyword match' }
  }

  // Drop listings that have been gone for 30+ days.
  const kept = [...existing.values()].filter((j) => daysSince(j.lastSeen) < 30)
  write('jobs', kept)
  write('companies', companies)
  write('settings', { ...read<Settings>('settings', {} as Settings), lastSweepAt: now })
  const result: SweepProgress = { running: false, done: companies.length, total: companies.length, newJobs: fresh.filter((j) => j.relevant).length, error: progress.error }
  onProgress(result)
  return result
}
