import { createHash } from 'crypto'
import { z } from 'zod'
import type { Application, Company, Job, JobCacheEntry, Profile, Settings, SweepProgress } from '../../shared/types'
import { read, write, nowIso } from '../store'
import { hasApiKey } from '../secrets'
import { bulkParse } from '../ai'
import { discoverSource } from './discover'
import { fetchFromSource, fetchJobDescription, getText, listingStatus, type JdHint, type RawJob } from './adapters'
import { actedOn, appFor } from '../../shared/missed'
import { isHighGrowth } from '../../shared/starters'

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]).catch(() => undefined)
  }))
}

// AI-first companies title GTM roles differently ("Engagement Principal",
// "Client Partner", "Head of India"); these were added in data version 2 and
// are merged into existing installs' keyword lists once.
export const INCLUDE_ADDED_V2 = [
  'engagement manager', 'engagement principal', 'engagement lead', 'client partner', 'client director',
  'account lead', 'strategic partnerships', 'gsi', 'business lead', 'india lead', 'head of india', 'market lead',
  'platform sales', 'solution sales', 'solutions sales', 'solution specialist', 'solutions specialist', 'deal'
]
export const DEFAULT_INCLUDE = [
  'sales', 'account director', 'account executive', 'account manager', 'business development',
  'country manager', 'country head', 'general manager', 'business head', 'revenue', 'go-to-market', 'gtm',
  'commercial', 'key account', 'strategic accounts', 'enterprise account', 'enterprise sales', 'enterprise business',
  'alliances', 'partnerships',
  'regional head', 'zonal head', 'cluster head', 'channel',
  ...INCLUDE_ADDED_V2
]
export const EXCLUDE_ADDED_V2 = ['sourcer', 'talent acquisition', 'talent partner']
export const DEFAULT_EXCLUDE = [
  'intern', 'internship', 'fresher', 'trainee', 'apprentice', 'sales development representative',
  'business development representative', 'sdr', 'bdr', 'sales associate', 'telecaller',
  'engineer', 'engineering', 'architect', 'developer', 'scientist', 'designer', 'recruiter', 'analyst', 'operations',
  ...EXCLUDE_ADDED_V2
]
const INDIA_RE = /\b(india|bangalore|bengaluru|mumbai|bombay|delhi|ncr|gurgaon|gurugram|hyderabad|pune|chennai|noida|kolkata|ahmedabad|kochi|jaipur|chandigarh)\b/i
// "Remote" on its own counts; "Remote - California" does not.
const ANYWHERE = '\\b(remote|anywhere|worldwide|global|work from home|wfh)\\b'
// SuccessFactors sites (HCLTech, Wipro…) can give only the country code, "IN",
// optionally with a PIN code after it. It has to come last, so a US state
// ("Indianapolis, IN, US") doesn't count.
const COUNTRY_CODE_IN = /(^|,\s*)IN(\s*,\s*\d{6})?\s*$/
// Regional / district / area / zonal sales managers run a territory and often
// a team. He counts them as leadership, so they're kept by rule rather than
// left to the AI screen (which has turned them down on the title alone).
const REGIONAL_LEAD = /\b(regional|district|area|zonal)\s+(sales|business)\s+(manager|director|head|leader|lead)\b/i
const NOT_LEAD = /\b(inside|inbound|smb|small business|associate|assistant|deputy|junior|trainee|intern)\b/i
export const isRegionalSalesLead = (title: string): boolean => REGIONAL_LEAD.test(title) && !NOT_LEAD.test(title)

export function isIndiaOrAnywhere(location: string): boolean {
  if (!location.trim() || INDIA_RE.test(location) || /\bIND\b/.test(location) || COUNTRY_CODE_IN.test(location.trim())) return true
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
    if (r.startsWith('Partnerships')) q.add('partnerships')
  }
  return [...q].slice(0, 7)
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
    const listing = chunk.map((j, n) =>
      `${n}. ${j.title} — ${j.company}${isHighGrowth(j.company) ? ' [AI-first / fast-growing]' : ''}${j.location ? ` (${j.location})` : ''}`).join('\n')
    const out = await bulkParse('jobs: judge relevance', {
      system:
        'You screen job listings for one senior candidate. Keep a role only if they would plausibly apply: right function ' +
        '(enterprise / B2B sales and sales leadership, including senior individual-contributor account roles, strategic ' +
        'partnerships and alliances, and customer-facing commercial roles at AI companies such as engagement managers or ' +
        'principals and solution specialists who own revenue) and right seniority (director-level individual contributor ' +
        'or above, or a leadership role). Be generous with title wording, strict about function and level. ' +
        'At companies marked [AI-first / fast-growing] the bar for level is lower, because a seat there is a step up: also ' +
        'keep senior individual-contributor enterprise roles (Enterprise, Strategic, Majors or Named Account Executive), ' +
        'and a startup\'s India or country sales lead even when it is titled "Sales Manager (India)" or similar. Still drop ' +
        'SMB, mid-market, commercial, associate, inbound, SDR/BDR and roles covering other regions from an Indian hub. ' +
        'Give a short reason for each kept role.',
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
  // Companies whose feed was read in full this sweep — only there can a missing role mean anything.
  const readOk = new Set<string>()
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
            for (const j of existing.values()) if (j.companyId === c.id && !j.goneAt) j.lastSeen = now
            c.lastStatus = 'Careers page unchanged — no AI needed'
            readOk.add(c.id)
          } else raw = r.jobs
        } else {
          raw = await fetchFromSource(src, queries, settings.indiaOnly !== false)
          // A known feed that stops answering is re-discovered next time.
          if (!raw && !['portal', 'none'].includes(src.type)) c.source = { ...src, detectedAt: '1970-01-01T00:00:00.000Z' }
        }
        if (raw) {
          readOk.add(c.id)
          for (const r of raw) {
            const id = `${c.id}:${r.externalId}`
            const prev = existing.get(id)
            if (prev) {
              prev.lastSeen = now; prev.title = r.title; prev.url = r.url; prev.location = r.location
              // Back on the board: relisted.
              if (prev.goneAt) { prev.goneAt = undefined; prev.missedChecks = 0 }
            } else {
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

  // Listings an older keyword list turned away get a second look once the
  // list has grown to cover them (only happens after keywords change).
  const fetchedIds = new Set(fresh.map((j) => j.id))
  for (const j of existing.values()) {
    if (fetchedIds.has(j.id) || j.lastSeen !== now || j.dismissed) continue
    if (j.relevant === false && j.relevanceReason === 'Not a sales role' && include?.test(j.title)) {
      j.relevant = null
      fresh.push(j)
    } else if (j.relevant === null) {
      // Waiting for a verdict — e.g. set back to unjudged when the screen's rules change.
      fresh.push(j)
    }
  }

  // Free prefilter first; AI only ever sees brand-new listings that pass it.
  const indiaOnly = settings.indiaOnly !== false
  const toJudge: Job[] = []
  for (const j of fresh) {
    if (exclude?.test(j.title)) { j.relevant = false; j.relevanceReason = 'Excluded keyword'; continue }
    if (include && !include.test(j.title)) { j.relevant = false; j.relevanceReason = 'Not a sales role'; continue }
    if (indiaOnly && !isIndiaOrAnywhere(j.location)) { j.relevant = false; j.relevanceReason = 'Outside India'; continue }
    if (isRegionalSalesLead(j.title)) { j.relevant = true; j.relevanceReason = 'Regional sales leadership role'; continue }
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

  // Matching roles that dropped out of a feed: ask the listing itself before
  // calling them closed (keyword-searched and capped feeds can lose live roles).
  const byId = new Map(companies.map((c) => [c.id, c]))
  const hintFor = (j: Job): JdHint => ({ source: byId.get(j.companyId)?.source, externalId: j.id.slice(j.companyId.length + 1) })
  const dropped = [...existing.values()]
    .filter((j) => j.relevant && !j.dismissed && !j.goneAt && j.lastSeen !== now)
    .slice(0, 60)
  const newlyGone: Job[] = []
  if (dropped.length) onProgress({ ...progress, current: 'checking roles that left the feeds' })
  await inBatches(dropped, 4, async (j) => {
    const status = await listingStatus(j.url, hintFor(j))
    if (status === 'open') { j.lastSeen = now; j.missedChecks = 0; return }
    if (status === 'unknown') {
      // Only a full read of the company's feed without the role counts against
      // it — unless nothing has shown it for six weeks.
      if (!readOk.has(j.companyId) && daysSince(j.lastSeen) < 45) return
      j.missedChecks = (j.missedChecks ?? 0) + 1
      if (j.missedChecks < (byId.get(j.companyId)?.source?.type === 'page' ? 2 : 3)) return
    }
    j.goneAt = now
    newlyGone.push(j)
  })

  // Keep a copy of every matching role's description while it's live, so it
  // can still be read after the company takes the listing down.
  const cache = read<Record<string, JobCacheEntry>>('jobcache', {})
  for (const j of existing.values()) if (cache[j.id] && !j.cachedAt) j.cachedAt = cache[j.id].at
  const uncached = [...existing.values()].filter((j) => j.relevant && !j.goneAt && !cache[j.id]).slice(0, 30)
  if (uncached.length) onProgress({ ...progress, current: 'saving copies of matching roles' })
  await inBatches(uncached, 3, async (j) => {
    const got = await fetchJobDescription(j.url, hintFor(j)).catch(() => null)
    if (got) { cache[j.id] = { text: got.text, at: now, generic: got.generic }; j.cachedAt = now }
  })

  // Matching roles are kept for a year so missed ones stay visible; the rest
  // drop off 30 days after they leave the feeds.
  const kept = [...existing.values()].filter((j) => (j.relevant ? daysSince(j.goneAt ?? j.lastSeen) < 365 : daysSince(j.lastSeen) < 30))
  const keptIds = new Set(kept.map((j) => j.id))
  write('jobs', kept)
  write('jobcache', Object.fromEntries(Object.entries(cache).filter(([id]) => keptIds.has(id))))
  write('companies', companies)
  write('settings', { ...read<Settings>('settings', {} as Settings), lastSweepAt: now })
  const matches = fresh.filter((j) => j.relevant)
  const apps = read<Application[]>('applications', [])
  const result: SweepProgress = {
    running: false, done: companies.length, total: companies.length, newJobs: matches.length, error: progress.error,
    highlights: matches.slice(0, 3).map((j) => `${j.title} — ${j.company}`),
    closed: newlyGone.filter((j) => !actedOn(appFor(j, apps))).length
  }
  onProgress(result)
  return result
}
