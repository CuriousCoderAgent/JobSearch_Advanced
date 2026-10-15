import { z } from 'zod'
import { webResearch } from './ai'
import { newId, nowIso, read, update } from './store'
import { isIndiaOrAnywhere } from './engine/sweep'
import type { Company, Contact, Job, OrgPeopleMeta, Profile } from '../shared/types'

// Finds the people worth contacting at a target company: India leadership and
// hiring managers first, then the international leaders who shape India
// hiring. Everything comes from live web search, and nothing is kept unless
// it can be traced to what the searches actually returned.

const FREE_MAIL = /@(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|proton|protonmail|rediffmail|aol|zoho)\./i

// Comparable form of a URL: no scheme, www, country subdomain on LinkedIn,
// query, fragment or trailing slash; lower-case.
export function normUrl(u: string): string {
  try {
    const x = new URL(u.trim())
    let host = x.hostname.toLowerCase().replace(/^www\./, '')
    if (host.endsWith('.linkedin.com')) host = 'linkedin.com'
    let path = x.pathname
    try { path = decodeURIComponent(path) } catch { /* keep as is */ }
    return `${host}${path.replace(/\/+$/, '').toLowerCase()}`
  } catch {
    return u.trim().toLowerCase()
  }
}

function urlsIn(text: string): Set<string> {
  return new Set([...text.matchAll(/https?:\/\/[^\s"'<>\\)\]]+/g)].map((m) => normUrl(m[0])))
}

const PERSON = z.object({
  name: z.string(),
  title: z.string(),
  location: z.string(),
  scope: z.string(),
  why: z.string(),
  confidence: z.string(),
  linkedin: z.string(),
  email: z.string(),
  sourceUrl: z.string()
})
const FINDINGS = z.object({
  indiaPresence: z.string(),
  emailPattern: z.object({ pattern: z.string(), sourceUrl: z.string() }).nullable(),
  people: z.array(PERSON)
})

const str = { type: 'string' } as const
const RECORD = {
  name: 'record_people',
  description:
    'Record the people you found, once, when your research is done. Use an empty string for any field you could ' +
    'not confirm from a search result.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      indiaPresence: { type: 'string', description: 'One line on the company’s India presence, from your sources' },
      emailPattern: {
        type: ['object', 'null'],
        description: 'The company’s email address format, only if a source you found states or shows it; otherwise null',
        properties: { pattern: { type: 'string', description: 'e.g. first.last@company.com' }, sourceUrl: str },
        required: ['pattern', 'sourceUrl']
      },
      people: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: str,
            title: { type: 'string', description: 'Current title at this company' },
            location: { type: 'string', description: 'City/country as shown, or empty' },
            scope: { type: 'string', description: '"india" for India-based roles, "global" for international stakeholders' },
            why: { type: 'string', description: 'One line: why this person matters for an India enterprise-sales hire' },
            confidence: { type: 'string', description: '"high" if two or more sources agree or the company/press confirms it; "low" if only a data-broker or directory page shows it' },
            linkedin: { type: 'string', description: 'The exact LinkedIn profile URL as it appeared in your results, or empty' },
            email: { type: 'string', description: 'Only an address published on a page you found, or empty' },
            sourceUrl: { type: 'string', description: 'The result URL that shows them in this role' }
          },
          required: ['name', 'title', 'location', 'scope', 'why', 'confidence', 'linkedin', 'email', 'sourceUrl']
        }
      }
    },
    required: ['indiaPresence', 'emailPattern', 'people']
  },
  validate: FINDINGS
}

const SYSTEM = [
  'You research who a job seeker should contact at a target company. Work only from what your web searches return',
  'in this session: every person you list must appear in a search result that shows them in their current role at',
  'this company. Do not rely on memory, do not guess names, and never construct a LinkedIn URL or an email address —',
  'record a LinkedIn URL only if that exact profile URL appeared in your results, and an email only if a page you',
  'found publishes that exact address. Collect professional information only (name, role, location, public profile',
  'links); never personal phone numbers, home addresses or personal email addresses. People change jobs often, so',
  'prefer recent sources and leave out anyone whose result suggests they have moved on.'
].join('\n')

export interface ResearchOutcome { contacts: Contact[]; meta: OrgPeopleMeta; added: number }

export async function researchCompany(company: Company): Promise<ResearchOutcome> {
  const profile = read<Profile>('profile', {} as Profile)
  const indiaJobs = read<Job[]>('jobs', [])
    .filter((j) => j.companyId === company.id && j.location && isIndiaOrAnywhere(j.location))
  const sampleTitles = [...new Set(indiaJobs.map((j) => j.title))].slice(0, 12)
  const known = read<Contact[]>('contacts', []).filter((c) => c.companyId === company.id)

  const { result, evidence } = await webResearch('people: research company', {
    system: SYSTEM,
    maxSearches: 8,
    record: RECORD,
    content: [
      `Company: ${company.name}${company.source?.url ? ` (careers: ${company.source.url})` : ''}`,
      `The candidate: a senior enterprise sales leader based in India, targeting ${profile.targetRoles?.join('; ') || 'senior enterprise sales roles'}${profile.locations ? ` in ${profile.locations}` : ''}.`,
      indiaJobs.length
        ? `The job radar currently sees ${indiaJobs.length} open roles at ${company.name} in India or remote, e.g.: ${sampleTitles.join('; ')}.`
        : `The job radar sees no open roles at ${company.name} in India right now.`,
      known.length ? `Already on the candidate's list — find other people, don't repeat these: ${known.map((c) => `${c.name} (${c.title})`).join('; ')}.` : '',
      '',
      'Find 5–10 people worth contacting about senior enterprise sales roles in India, in this priority order:',
      '1. India leadership — country head, MD or GM India, head of India sales or go-to-market.',
      '2. India-based sales leaders likely to be hiring managers — enterprise sales directors, regional heads,',
      '   strategic account leaders, partnerships and alliances leads.',
      '3. Recruiters or talent partners who hire go-to-market roles in India or APAC.',
      '4. Two or three international stakeholders who shape India hiring or India expansion — APAC/APJ sales heads,',
      '   international expansion leads, or the CRO/VP Sales who owns India.',
      'Aim for at least five people from groups 1–3 when the company has them. Leave out engineering, R&D, product and',
      'finance people unless they are the head of the whole India operation.',
      '',
      'Searches that work: LinkedIn profile searches combining the company name, "India" and a role keyword (sales',
      'director, head of sales, country manager, account director, partnerships, talent acquisition, recruiter); news',
      'about the company’s India launch or leadership appointments; and the same for APAC/APJ sales leadership.',
      'If the company has no India presence yet, say so and focus on the people driving its India or international',
      'expansion. Record each title exactly as the source states it — put any caveat in "why" and "confidence", not',
      'the title. Then call record_people once.'
    ].filter(Boolean).join('\n')
  })

  // Keep only what the searches actually returned.
  const seen = urlsIn(evidence)
  const evidenceLower = evidence.toLowerCase()
  let dropped = 0
  const found: Omit<Contact, 'id' | 'status' | 'addedAt'>[] = []
  for (const p of result.people) {
    const name = p.name.trim()
    if (!name || !p.title.trim()) { dropped++; continue }
    const linkedin = /linkedin\.com\/in\//i.test(p.linkedin) && seen.has(normUrl(p.linkedin)) ? p.linkedin.trim() : undefined
    const sourceOk = !!p.sourceUrl && seen.has(normUrl(p.sourceUrl))
    if (!linkedin && !sourceOk) { dropped++; continue }
    const email = p.email.trim().toLowerCase()
    const emailOk = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email) && !FREE_MAIL.test(email) && evidenceLower.includes(email)
    found.push({
      companyId: company.id, companyName: company.name, name, title: p.title.trim(), location: p.location.trim() || undefined,
      scope: p.scope.toLowerCase().startsWith('g') ? 'global' : 'india', why: p.why.trim() || undefined,
      confidence: p.confidence.toLowerCase().startsWith('h') ? 'high' : 'low',
      linkedin, email: emailOk ? email : undefined, emailSource: emailOk ? 'public' : undefined,
      sourceUrl: sourceOk ? p.sourceUrl.trim() : linkedin, origin: 'research'
    })
  }

  const meta: OrgPeopleMeta = {
    researchedAt: nowIso(),
    indiaPresence: result.indiaPresence.trim() || undefined,
    emailPattern: result.emailPattern && result.emailPattern.pattern.includes('@') && seen.has(normUrl(result.emailPattern.sourceUrl))
      ? { pattern: result.emailPattern.pattern.trim(), sourceUrl: result.emailPattern.sourceUrl.trim() }
      : undefined,
    dropped
  }
  update<Record<string, OrgPeopleMeta>>('orgpeople', {}, (m) => ({ ...m, [company.id]: meta }))

  // Merge with what's already there: never overwrite your own status, notes or emails.
  let added = 0
  update<Contact[]>('contacts', [], (list) => {
    const next = [...list]
    for (const f of found) {
      const key = f.linkedin ? normUrl(f.linkedin) : null
      const i = next.findIndex((c) => c.companyId === company.id &&
        ((key && c.linkedin && normUrl(c.linkedin) === key) || c.name.toLowerCase() === f.name.toLowerCase()))
      if (i >= 0) {
        const c = next[i]
        next[i] = {
          ...c, title: f.title, location: f.location ?? c.location, scope: f.scope, why: f.why ?? c.why, confidence: f.confidence,
          linkedin: c.linkedin ?? f.linkedin, sourceUrl: f.sourceUrl ?? c.sourceUrl,
          ...(c.email ? {} : { email: f.email, emailSource: f.emailSource })
        }
      } else {
        next.push({ ...f, id: newId(), status: 'to-contact', addedAt: nowIso() })
        added++
      }
    }
    return next
  })
  return { contacts: read<Contact[]>('contacts', []).filter((c) => c.companyId === company.id), meta, added }
}

// "first.last@acme.com" applied to a name. Returns null when the pattern uses
// a part the name doesn't have.
export function applyEmailPattern(pattern: string, name: string): string | null {
  const parts = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean)
  if (!parts.length) return null
  const first = parts[0]
  const last = parts.length > 1 ? parts[parts.length - 1] : ''
  const p = pattern.toLowerCase().replace(/[{}[\]<>]/g, '').trim()
  const at = p.indexOf('@')
  if (at < 1 || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(p.slice(at + 1))) return null
  // Read the local part as tokens, longest first: "flast" = f + last.
  const tokens: [string, () => string][] = [
    ['firstname', () => first], ['lastname', () => last], ['first', () => first], ['last', () => last],
    ['f', () => first[0]], ['l', () => last[0] ?? '']
  ]
  let out = ''
  for (let i = 0, local = p.slice(0, at); i < local.length;) {
    if ('._-'.includes(local[i])) { out += local[i++]; continue }
    const hit = tokens.find(([t]) => local.startsWith(t, i))
    if (!hit) return null
    const value = hit[1]()
    if (!value) return null
    out += value
    i += hit[0].length
  }
  return out ? `${out}${p.slice(at)}` : null
}
