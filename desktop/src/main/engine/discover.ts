import type { Company, CompanySource } from '../../shared/types'
import { SLUG_ADAPTERS, getText } from './adapters'
import { bulkSearchText } from '../ai'
import { nowIso } from '../store'
import { knownSource } from './registry'

// Work out where a company's jobs live, spending nothing if at all possible:
//   1. a careers URL you gave us, or free guesses at common careers URLs,
//      fingerprinted for a known job system (Workday, Greenhouse, ...)
//   2. free slug guesses against Greenhouse / Lever / Ashby / SmartRecruiters
//   3. only then, ONE cheap web search to find the careers page — cached forever.

function mostCommon(values: string[]): string | undefined {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
}

export function fingerprint(html: string, pageUrl: string): CompanySource | null {
  const now = nowIso()
  const wd = [...html.matchAll(/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/g)]
    .filter((m) => m[3] !== 'wday' && m[3] !== 'job')
  if (wd.length) {
    const key = mostCommon(wd.map((m) => `${m[1]}|${m[2]}|${m[3]}`))!
    const [tenant, pod, site] = key.split('|')
    return { type: 'workday', host: `${tenant}.${pod}.myworkdayjobs.com`, tenant, site, url: pageUrl, detectedAt: now }
  }
  const slugFrom = (re: RegExp): string | undefined =>
    mostCommon([...html.matchAll(re)].map((m) => m[1]).filter((s) => !/^(embed|v1|jobs|boards)$/i.test(s)))
  const gh = slugFrom(/(?:boards|job-boards)(?:-api)?\.greenhouse\.io\/(?:v1\/boards\/|embed\/job_board(?:\/js)?\?for=)?([A-Za-z0-9_-]+)/g)
  if (gh) return { type: 'greenhouse', slug: gh, url: pageUrl, detectedAt: now }
  const lv = slugFrom(/jobs\.lever\.co\/([A-Za-z0-9_-]+)/g)
  if (lv) return { type: 'lever', slug: lv, url: pageUrl, detectedAt: now }
  const ab = slugFrom(/jobs\.ashbyhq\.com\/([A-Za-z0-9_.-]+)/g)
  if (ab) return { type: 'ashby', slug: ab, url: pageUrl, detectedAt: now }
  const sr = slugFrom(/(?:careers|jobs)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/g)
  if (sr) return { type: 'smartrecruiters', slug: sr, url: pageUrl, detectedAt: now }
  const or = html.match(/([a-z0-9-]+\.fa\.[a-z0-9]+\.oraclecloud\.com)\/hcmUI\/CandidateExperience\/[a-z]{2}\/sites\/([A-Za-z0-9_]+)/)
  if (or) return { type: 'oracle', host: or[1], siteNumber: or[2], url: pageUrl, detectedAt: now }
  if (/successfactors|jobs2web|rmk-map/i.test(html)) {
    try { return { type: 'successfactors', host: new URL(pageUrl).host, url: pageUrl, detectedAt: now } } catch { /* fall through */ }
  }
  const portal = html.match(/https?:\/\/[a-z0-9-]+\.(?:darwinbox\.in|keka\.com|zohorecruit\.[a-z.]+|freshteam\.com)[^"'\s<]*/i)
  if (portal) return { type: 'portal', url: portal[0], detectedAt: now }
  return null
}

// Full-name variants only: a shortened slug ("pine" for Pine Labs) can match
// an unrelated company's job board.
function slugVariants(name: string): string[] {
  const base = name.toLowerCase().trim().replace(/\.(com|in|io|co)$/, '')
  return [...new Set([
    base.replace(/[^a-z0-9]/g, ''),
    base.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  ])].filter((s) => s.length >= 2)
}

function guessUrls(name: string): string[] {
  const lower = name.toLowerCase().trim()
  const domain = lower.match(/^([a-z0-9-]+)\.(com|in|io|co|ai)$/)
  if (domain) {
    const d = `${domain[1]}.${domain[2]}`
    return [`https://careers.${d}/`, `https://jobs.${d}/`, `https://www.${d}/careers`]
  }
  const d = lower.replace(/&/g, 'and').replace(/[^a-z0-9]/g, '')
  return [
    `https://careers.${d}.com/`, `https://www.${d}.com/careers`, `https://${d}.com/careers`,
    `https://jobs.${d}.com/`, `https://www.${d}.in/careers`
  ]
}

async function fingerprintUrl(url: string): Promise<{ src: CompanySource | null; html: string | null }> {
  const html = await getText(url, 8000)
  if (!html || html.length < 500) return { src: null, html: null }
  return { src: fingerprint(html, url), html }
}

function isUsefulPage(html: string | null): boolean {
  if (!html) return false
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  return text.replace(/\s+/g, ' ').length > 1500 && /job|career|opening|position|role/i.test(text)
}

export async function discoverSource(company: Company, allowPaidSearch: boolean): Promise<CompanySource> {
  const now = nowIso()
  const known = knownSource(company.name)
  if (known && !company.careersUrl) return { ...known, detectedAt: now }

  // 1. A URL you gave us.
  if (company.careersUrl) {
    const { src, html } = await fingerprintUrl(company.careersUrl)
    if (src) return src
    if (isUsefulPage(html)) return { type: 'page', url: company.careersUrl, detectedAt: now }
  }

  // 2. Free slug guesses on the ATSs that expose clean public APIs.
  for (const slug of slugVariants(company.name)) {
    for (const [type, fn] of Object.entries(SLUG_ADAPTERS)) {
      const jobs = await fn(slug)
      if (jobs && jobs.length) return { type: type as CompanySource['type'], slug, detectedAt: now }
    }
  }

  // 3. Free guesses at common careers URLs, fetched in parallel.
  const guesses = guessUrls(company.name)
  const probed = await Promise.all(guesses.map((u) => fingerprintUrl(u)))
  const hit = probed.find((p) => p.src)
  if (hit?.src) return hit.src
  const pageIdx = probed.findIndex((p) => isUsefulPage(p.html))
  const fallbackPage = pageIdx >= 0 ? guesses[pageIdx] : undefined

  // 4. One cheap web search, only if the free routes found nothing.
  if (allowPaidSearch) {
    try {
      const answer = await bulkSearchText(
        'jobs: find careers page',
        `What is the URL of ${company.name}'s official careers / job openings page (the page listing open roles, ` +
          `ideally for India)? Reply with only the URL. If you cannot find it, reply NONE.`
      )
      const url = answer.match(/https?:\/\/[^\s)\]>"']+/)?.[0]?.replace(/[.,]+$/, '')
      if (url) {
        const { src, html } = await fingerprintUrl(url)
        if (src) return src
        if (isUsefulPage(html)) return { type: 'page', url, detectedAt: now }
        return { type: 'portal', url, detectedAt: now }
      }
    } catch {
      // No key or budget reached: carry on with what we have.
    }
  }

  if (fallbackPage) return { type: 'page', url: fallbackPage, detectedAt: now }
  return { type: 'none', detectedAt: now }
}
