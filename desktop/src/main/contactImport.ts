import { readFileSync } from 'fs'
import { basename, extname } from 'path'
import JSZip from 'jszip'
import { newId, nowIso, read, update, write } from './store'
import { normUrl } from './people'
import {
  CONNECTION_STATUSES, CONTACT_STATUSES,
  type Company, type Contact, type ContactImportResult, type ContactStatus, type OrgPeopleMeta
} from '../shared/types'

// Imports a contact map (.xlsx or .csv) into People. Columns are matched by
// their headings, so a re-saved or edited sheet still lines up: the sheet
// needs a Company and a Name column; everything else is optional.

type Row = Record<string, string>
interface Table { headers: string[]; rows: Row[]; links: Row[] }

// ---------- Reading .xlsx (just enough of the format: cells, strings, links) ----------

const unescapeXml = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&')
const textOf = (xml: string): string => unescapeXml([...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''))

async function readXlsx(file: string): Promise<{ name: string; grid: string[][]; links: string[][] }[]> {
  const zip = await JSZip.loadAsync(readFileSync(file))
  const get = async (p: string): Promise<string> => (await zip.file(p)?.async('string')) ?? ''
  const shared = [...(await get('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
  const workbook = await get('xl/workbook.xml')
  const wbRels = Object.fromEntries([...(await get('xl/_rels/workbook.xml.rels')).matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]))
  const sheets = []
  for (const s of workbook.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const target = wbRels[s[2]]?.replace(/^\/?xl\//, '')
    if (!target) continue
    const path = `xl/${target}`
    const xml = await get(path)
    const relsXml = await get(path.replace(/worksheets\/(.+)$/, 'worksheets/_rels/$1.rels'))
    const rels = Object.fromEntries([...relsXml.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], unescapeXml(m[2])]))
    const linkAt = Object.fromEntries([...xml.matchAll(/<hyperlink [^>]*ref="([A-Z]+\d+)"[^>]*r:id="([^"]+)"/g)].map((m) => [m[1], rels[m[2]]]))
    const grid: string[][] = []
    const links: string[][] = []
    for (const r of xml.matchAll(/<row [^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const ri = +r[1] - 1
      grid[ri] = []
      links[ri] = []
      for (const c of r[2].matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const col = [...c[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
        const type = c[3].match(/t="([^"]+)"/)?.[1]
        const inner = c[4] ?? ''
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? ''
        grid[ri][col] = (type === 'inlineStr' ? textOf(inner) : type === 's' ? shared[+v] ?? '' : unescapeXml(v)).trim()
        links[ri][col] = linkAt[`${c[1]}${c[2]}`] ?? ''
      }
    }
    sheets.push({ name: unescapeXml(s[1]), grid, links })
  }
  return sheets
}

// ---------- Reading .csv ----------

function readCsv(file: string): string[][] {
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell.trim()); cell = '' } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell.trim()); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row) }
  return rows
}

// The first row that names both a company and a person column is the header.
function tableIn(grid: string[][], links: string[][], need: RegExp[]): Table | null {
  for (let i = 0; i < Math.min(grid.length, 40); i++) {
    const h = Array.from(grid[i] ?? [], (x) => (x ?? '').trim())
    // Each required heading in its own short cell, so a title row such as
    // "COMPANY INDEX | INDIA OUTREACH ROUTES" can't pass for a header.
    const at = need.map((re) => h.findIndex((x) => x.length <= 60 && re.test(x)))
    if (at.some((c) => c < 0) || new Set(at).size !== at.length) continue
    const rows: Row[] = []
    const rowLinks: Row[] = []
    for (let j = i + 1; j < grid.length; j++) {
      const r = grid[j]
      if (!r || !r.some((x) => x)) continue
      rows.push(Object.fromEntries(h.map((k, c) => [k, r[c] ?? ''])))
      rowLinks.push(Object.fromEntries(h.map((k, c) => [k, links[j]?.[c] ?? ''])))
    }
    return { headers: h, rows, links: rowLinks }
  }
  return null
}

const COMPANY = /^(company|organi[sz]ation|org)\b/i
const NAME = /^(name|full name|person|contact name)$/i

function column(headers: string[], ...tests: ((h: string) => boolean)[]): string | undefined {
  for (const t of tests) {
    const hit = headers.find((h) => t(h.toLowerCase()))
    if (hit) return hit
  }
  return undefined
}

// Excel stores dates as day counts from 1900; sheets may also hold plain text.
function dateOf(v: string): string | undefined {
  if (!v) return undefined
  if (/^\d{5}(\.\d+)?$/.test(v)) return new Date(Math.round((+v - 25569) * 864e5)).toISOString()
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

const STATUS_ALIASES: Record<string, ContactStatus> = {
  'not started': 'to-contact', 'to contact': 'to-contact', 'meeting set': 'meeting', 'meeting scheduled': 'meeting',
  'call scheduled': 'meeting', referral: 'referred', 'not a fit': 'not-relevant'
}
function statusOf(v: string): ContactStatus | undefined {
  const s = v.trim().toLowerCase()
  if (!s) return undefined
  return CONTACT_STATUSES.find((x) => x.label.toLowerCase() === s || x.id === s)?.id ?? STATUS_ALIASES[s]
}
function connectionOf(v: string): Contact['connection'] {
  const s = v.trim().toLowerCase()
  if (!s) return undefined
  if (/^(yes|y|true|connected)$/.test(s)) return 'connected'
  if (/request|pending|sent|invited/.test(s)) return 'requested'
  if (/^(no|n|false|not connected)$/.test(s)) return 'not-connected'
  return CONNECTION_STATUSES.find((x) => x.label.toLowerCase() === s)?.id
}

export async function importContacts(file: string, addCompany: (name: string) => Company): Promise<ContactImportResult> {
  const ext = extname(file).toLowerCase()
  const sheets = ext === '.csv'
    ? [{ name: basename(file), grid: readCsv(file), links: [] as string[][] }]
    : ext === '.xlsx' ? await readXlsx(file) : null
  if (!sheets) throw new Error('Use an Excel (.xlsx) or CSV file.')

  // The contacts table: the sheet with Company and Name columns and the most rows.
  const tables = sheets.map((s) => ({ s, t: tableIn(s.grid, s.links, [COMPANY, NAME]) })).filter((x) => x.t && x.t.rows.length)
  const best = tables.sort((a, b) => b.t!.rows.length - a.t!.rows.length)[0]
  if (!best) throw new Error('No sheet with “Company” and “Name” columns was found.')
  const { headers, rows, links } = best.t!

  const col = {
    company: column(headers, (h) => COMPANY.test(h))!,
    name: column(headers, (h) => NAME.test(h))!,
    email: column(headers, (h) => /^e-?mail\b/.test(h) && !/^e-?mail (status|evidence|source|note)/.test(h)),
    linkedin: column(headers, (h) => h.includes('linkedin') && !/status/.test(h)),
    title: column(headers, (h) => /designation|title|role/.test(h) && !/check|evidence|url/.test(h)),
    geo: column(headers, (h) => /geograph|scope|location|region/.test(h)),
    type: column(headers, (h) => h === 'contact type' || h === 'type'),
    priority: column(headers, (h) => h.startsWith('priority')),
    why: column(headers, (h) => /why|approach/.test(h)),
    roleCheck: column(headers, (h) => h === 'role check'),
    emailStatus: column(headers, (h) => h === 'email status'),
    source: column(headers, (h) => /evidence|source/.test(h) && !h.includes('email')),
    emailSource: column(headers, (h) => /evidence|source/.test(h) && h.includes('email')),
    status: column(headers, (h) => h === 'outreach status', (h) => h === 'status'),
    connection: column(headers, (h) => /connect/.test(h)),
    lastContacted: column(headers, (h) => h.startsWith('last contacted')),
    followUp: column(headers, (h) => /follow.?up/.test(h)),
    notes: column(headers, (h) => /notes?$/.test(h)),
    checked: column(headers, (h) => /research checked|checked on|researched/.test(h))
  }
  const cell = (r: Row, k: keyof typeof col): string => (col[k] ? (r[col[k]!] ?? '').trim() : '')
  const linkOf = (r: Row, l: Row, k: keyof typeof col): string => {
    const v = cell(r, k)
    return /^https?:\/\//i.test(v) ? v : (col[k] ? (l[col[k]!] ?? '') : '')
  }

  // Companies: match the watch list by name; add any that aren't on it yet.
  const companies = read<Company[]>('companies', [])
  const companiesAdded: string[] = []
  const companyFor = (name: string): Company => {
    const hit = companies.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase())
    if (hit) return hit
    const c = addCompany(name.trim())
    companies.push(c)
    companiesAdded.push(c.name)
    return c
  }

  const contacts = read<Contact[]>('contacts', [])
  let added = 0
  let updated = 0
  let skipped = 0
  rows.forEach((r, i) => {
    const companyName = cell(r, 'company')
    const name = cell(r, 'name')
    if (!companyName || !name) { skipped++; return }
    const company = companyFor(companyName)
    const geo = cell(r, 'geo')
    const li = linkOf(r, links[i], 'linkedin')
    const linkedin = /linkedin\.com\/in\//i.test(li) ? li : undefined
    const emailRaw = cell(r, 'email').toLowerCase()
    const email = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(emailRaw) ? emailRaw : undefined
    const priority = Number(cell(r, 'priority'))
    const fields: Partial<Contact> = {
      title: cell(r, 'title'),
      location: geo || undefined,
      // "India", "India / APAC", "APAC / India" are India routes; "Global / India" and "APAC" are international.
      scope: !geo || (/india|south asia/i.test(geo) && !/^\s*global/i.test(geo)) ? 'india' : 'global',
      why: cell(r, 'why') || undefined,
      priority: priority === 1 || priority === 2 || priority === 3 ? priority : undefined,
      contactType: cell(r, 'type') || undefined,
      roleCheck: cell(r, 'roleCheck') || undefined,
      linkedin,
      sourceUrl: linkOf(r, links[i], 'source') || undefined,
      ...(email ? { email, emailSource: 'public' as const, emailNote: cell(r, 'emailStatus') || undefined, emailSourceUrl: linkOf(r, links[i], 'emailSource') || undefined } : {})
    }
    const tracking: Partial<Contact> = {
      status: statusOf(cell(r, 'status')),
      connection: connectionOf(cell(r, 'connection')),
      lastContactedAt: dateOf(cell(r, 'lastContacted')),
      followUpDate: dateOf(cell(r, 'followUp'))?.slice(0, 10),
      notes: cell(r, 'notes') || undefined
    }
    const key = linkedin ? normUrl(linkedin) : null
    const existing = contacts.find((c) => c.companyId === company.id &&
      ((key && c.linkedin && normUrl(c.linkedin) === key) || c.name.toLowerCase() === name.toLowerCase()))
    if (existing) {
      // The sheet refreshes the research; your own tracking in the app wins
      // unless the app hasn't recorded anything yet.
      Object.assign(existing, Object.fromEntries(Object.entries(fields).filter(([k, v]) =>
        v !== undefined && v !== '' && !(k.startsWith('email') && existing.emailSource === 'manual'))))
      if (existing.status === 'to-contact' && tracking.status) existing.status = tracking.status
      if ((!existing.connection || existing.connection === 'not-connected') && tracking.connection) existing.connection = tracking.connection
      existing.lastContactedAt ??= tracking.lastContactedAt
      existing.followUpDate ??= tracking.followUpDate
      existing.notes ??= tracking.notes
      updated++
    } else {
      contacts.push({
        id: newId(), companyId: company.id, companyName: company.name, name, scope: 'india', title: '',
        ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && v !== '')),
        status: tracking.status ?? 'to-contact', connection: tracking.connection ?? 'not-connected',
        lastContactedAt: tracking.lastContactedAt, followUpDate: tracking.followUpDate, notes: tracking.notes,
        origin: 'import', addedAt: nowIso()
      } as Contact)
      added++
    }
  })
  write('contacts', contacts)

  // A company index sheet, if there is one, gives each company's suggested route in.
  const researchedAt = dateOf(rows.map((r) => cell(r, 'checked')).find(Boolean) ?? '') ?? nowIso()
  const index = sheets.filter((s) => s !== best.s)
    .map((s) => tableIn(s.grid, s.links, [COMPANY, /first contact|suggested focus|route/i])).find(Boolean)
  update<Record<string, OrgPeopleMeta>>('orgpeople', {}, (meta) => {
    const next = { ...meta }
    const touched = new Set(contacts.filter((c) => c.origin === 'import').map((c) => c.companyId))
    for (const id of touched) next[id] = { ...next[id], researchedAt: next[id]?.researchedAt ?? researchedAt, dropped: next[id]?.dropped ?? 0 }
    for (const r of index?.rows ?? []) {
      const h = index!.headers
      const get = (re: RegExp): string => { const k = h.find((x) => re.test(x)); return k ? (r[k] ?? '').trim() : '' }
      const name = get(COMPANY)
      const co = companies.find((c) => c.name.toLowerCase() === name.toLowerCase())
      if (!co) continue
      next[co.id] = {
        ...next[co.id], researchedAt: next[co.id]?.researchedAt ?? researchedAt, dropped: next[co.id]?.dropped ?? 0,
        category: get(/^category/i) || next[co.id]?.category,
        fit: get(/suggested focus|fit/i) || next[co.id]?.fit,
        approach: get(/route|approach/i) || next[co.id]?.approach,
        firstContact: get(/first contact/i) || next[co.id]?.firstContact
      }
    }
    return next
  })

  return { file: basename(file), added, updated, companiesAdded, skipped }
}
