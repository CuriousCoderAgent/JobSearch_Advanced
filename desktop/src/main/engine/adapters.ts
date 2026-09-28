// Free job feeds. None of these cost anything — they are the public JSON/RSS
// endpoints that companies' own careers sites use. AI is only needed for the
// minority of companies that run a fully custom careers page.
import type { CompanySource } from '../../shared/types'

export interface RawJob {
  externalId: string
  title: string
  url: string
  location: string
  postedAt?: string | null
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'

export async function getJson(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers || {}) },
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function getText(url: string, timeoutMs = 15000): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function greenhouse(slug: string): Promise<RawJob[] | null> {
  const j = (await getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`)) as any
  if (!j || !Array.isArray(j.jobs)) return null
  return j.jobs.map((x: any) => ({
    externalId: `gh-${slug}-${x.id}`, title: x.title, url: x.absolute_url,
    location: x.location?.name || '', postedAt: x.updated_at || null
  }))
}

async function lever(slug: string): Promise<RawJob[] | null> {
  const j = (await getJson(`https://api.lever.co/v0/postings/${slug}?mode=json`)) as any
  if (!Array.isArray(j)) return null
  return j.map((x: any) => ({
    externalId: `lv-${slug}-${x.id}`, title: x.text, url: x.hostedUrl,
    location: x.categories?.location || '',
    postedAt: x.createdAt ? new Date(x.createdAt).toISOString() : null
  }))
}

async function ashby(slug: string): Promise<RawJob[] | null> {
  const j = (await getJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=false`)) as any
  if (!j || !Array.isArray(j.jobs)) return null
  return j.jobs.map((x: any) => ({
    externalId: `ab-${slug}-${x.id}`, title: x.title, url: x.jobUrl || x.applyUrl,
    location: x.location || '', postedAt: x.publishedAt || null
  }))
}

async function smartrecruiters(slug: string): Promise<RawJob[] | null> {
  const out: RawJob[] = []
  for (let offset = 0; offset < 300; offset += 100) {
    const j = (await getJson(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100&offset=${offset}`)) as any
    if (!j || !Array.isArray(j.content)) return offset === 0 ? null : out
    for (const x of j.content) {
      out.push({
        externalId: `sr-${slug}-${x.id}`, title: x.name,
        url: `https://jobs.smartrecruiters.com/${slug}/${x.id}`,
        location: [x.location?.city, x.location?.country].filter(Boolean).join(', '),
        postedAt: x.releasedDate || null
      })
    }
    if (j.content.length < 100) break
  }
  return out
}

// Workday: large enterprises list thousands of roles, so search by the
// candidate's own keywords instead of pulling everything.
async function workday(src: CompanySource, queries: string[]): Promise<RawJob[] | null> {
  const { host, tenant, site } = src
  if (!host || !tenant || !site) return null
  const endpoint = `https://${host}/wday/cxs/${tenant}/${site}/jobs`
  const seen = new Map<string, RawJob>()
  let anyOk = false
  for (const q of queries) {
    for (let offset = 0; offset < 60; offset += 20) {
      const j = (await getJson(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: q })
      })) as any
      if (!j || !Array.isArray(j.jobPostings)) break
      anyOk = true
      for (const x of j.jobPostings) {
        if (!x.externalPath) continue
        // externalPath looks like /job/India---Bangalore/Title_JR123 — the
        // first segment is the primary location.
        const locSeg = String(x.externalPath).split('/')[2] || ''
        const location = x.locationsText && !/^\d+ Locations$/i.test(x.locationsText)
          ? x.locationsText
          : locSeg.replace(/-{2,}/g, ', ').replace(/-/g, ' ')
        seen.set(x.externalPath, {
          externalId: `wd-${tenant}-${x.bulletFields?.[0] || x.externalPath}`,
          title: x.title,
          url: `https://${host}/en-US/${site}${x.externalPath}`,
          location,
          postedAt: null
        })
      }
      if (j.jobPostings.length < 20) break
    }
  }
  return anyOk ? [...seen.values()] : null
}

// SAP SuccessFactors career sites publish an RSS feed per keyword search.
async function successfactors(src: CompanySource, queries: string[]): Promise<RawJob[] | null> {
  if (!src.host) return null
  const seen = new Map<string, RawJob>()
  let anyOk = false
  for (const q of queries) {
    const xml = await getText(`https://${src.host}/services/rss/job/?locale=en_US&keywords=${encodeURIComponent(q)}`)
    if (!xml || !xml.includes('<rss')) continue
    anyOk = true
    for (const item of xml.match(/<item>[\s\S]*?<\/item>/g) || []) {
      const pick = (tag: string): string =>
        (item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] || '')
          .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').trim()
      const title = pick('title')
      const link = pick('link')
      if (!title || !link) continue
      const loc = title.match(/\(([^()]+)\)\s*$/)?.[1] || ''
      seen.set(link, {
        externalId: `sf-${src.host}-${link.split('/').filter(Boolean).pop()}`,
        title: title.replace(/\s*\([^()]+\)\s*$/, ''),
        url: link, location: loc, postedAt: pick('pubDate') || null
      })
    }
  }
  return anyOk ? [...seen.values()] : null
}

// Oracle Cloud HCM candidate-experience sites have a public REST finder.
async function oracle(src: CompanySource, queries: string[]): Promise<RawJob[] | null> {
  if (!src.host || !src.siteNumber) return null
  const seen = new Map<string, RawJob>()
  let anyOk = false
  for (const q of queries) {
    const finder = `findReqs;siteNumber=${src.siteNumber},keyword="${q.replace(/"/g, '')}",limit=50,sortBy=POSTING_DATES_DESC`
    const j = (await getJson(
      `https://${src.host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=${encodeURIComponent(finder)}`
    )) as any
    const list = j?.items?.[0]?.requisitionList
    if (!Array.isArray(list)) continue
    anyOk = true
    for (const r of list) {
      seen.set(String(r.Id), {
        externalId: `or-${src.host}-${r.Id}`, title: r.Title,
        url: `https://${src.host}/hcmUI/CandidateExperience/en/sites/${src.siteNumber}/job/${r.Id}`,
        location: r.PrimaryLocation || '', postedAt: r.PostedDate || null
      })
    }
  }
  return anyOk ? [...seen.values()] : null
}

async function amazon(queries: string[], indiaOnly: boolean): Promise<RawJob[] | null> {
  const seen = new Map<string, RawJob>()
  let anyOk = false
  for (const q of queries) {
    const country = indiaOnly ? '&normalized_country_code%5B%5D=IND' : ''
    const j = (await getJson(`https://www.amazon.jobs/en/search.json?base_query=${encodeURIComponent(q)}${country}&result_limit=100&sort=recent`)) as any
    if (!j || !Array.isArray(j.jobs)) continue
    anyOk = true
    for (const x of j.jobs) {
      seen.set(String(x.id_icims), {
        externalId: `amz-${x.id_icims}`, title: x.title,
        url: `https://www.amazon.jobs${x.job_path}`,
        location: x.normalized_location || x.location || '', postedAt: x.posted_date || null
      })
    }
  }
  return anyOk ? [...seen.values()] : null
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const SLUG_ADAPTERS: Record<string, (slug: string) => Promise<RawJob[] | null>> = {
  greenhouse, lever, ashby, smartrecruiters
}

export async function fetchFromSource(
  src: CompanySource,
  queries: string[],
  indiaOnly: boolean
): Promise<RawJob[] | null> {
  switch (src.type) {
    case 'greenhouse':
    case 'lever':
    case 'ashby':
    case 'smartrecruiters':
      return src.slug ? SLUG_ADAPTERS[src.type](src.slug) : null
    case 'workday': return workday(src, queries)
    case 'successfactors': return successfactors(src, queries)
    case 'oracle': return oracle(src, queries)
    case 'amazon': return amazon(queries, indiaOnly)
    default: return null
  }
}
