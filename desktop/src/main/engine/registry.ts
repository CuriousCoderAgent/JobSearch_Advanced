import type { CompanySource } from '../../shared/types'

// Job feeds for well-known employers, each verified live on 2026-09-28.
// Checked before any discovery, so these companies cost nothing and are
// never mis-identified. Keys are lower-case names/aliases.
const wd = (tenant: string, pod: string, site: string): Omit<CompanySource, 'detectedAt'> =>
  ({ type: 'workday', host: `${tenant}.${pod}.myworkdayjobs.com`, tenant, site })
const sf = (host: string): Omit<CompanySource, 'detectedAt'> => ({ type: 'successfactors', host })
const or = (host: string, siteNumber: string): Omit<CompanySource, 'detectedAt'> => ({ type: 'oracle', host, siteNumber })
const ats = (type: CompanySource['type'], slug: string): Omit<CompanySource, 'detectedAt'> => ({ type, slug })

const ENTRIES: [string[], Omit<CompanySource, 'detectedAt'>][] = [
  [['salesforce'], wd('salesforce', 'wd12', 'External_Career_Site')],
  [['accenture'], wd('accenture', 'wd103', 'AccentureCareers')],
  [['genpact'], wd('genpact', 'wd108', 'External_Careers')],
  [['browserstack'], wd('browserstack', 'wd3', 'External')],
  [['adobe'], wd('adobe', 'wd5', 'external_experienced')],
  [['cisco'], wd('cisco', 'wd5', 'Cisco_Careers')],
  [['coca-cola', 'coca cola', 'the coca-cola company'], wd('coke', 'wd1', 'coca-cola-careers')],
  [['hp', 'hp inc'], wd('hp', 'wd5', 'ExternalCareerSite')],
  [['intel'], wd('intel', 'wd1', 'External')],
  [['kyndryl'], wd('kyndryl', 'wd5', 'KyndrylProfessionalCareers')],
  [['mastercard'], wd('mastercard', 'wd1', 'CorporateCareers')],
  [['nvidia'], wd('nvidia', 'wd5', 'NVIDIAExternalCareerSite')],
  [['workday'], wd('workday', 'wd5', 'Workday')],
  [['ey', 'ernst & young', 'ernst and young'], sf('careers.ey.com')],
  [['pwc', 'pricewaterhousecoopers'], sf('careers.pwc.com')],
  [['nestle', 'nestlé'], sf('jobdetails.nestle.com')],
  [['kpmg', 'kpmg india'], or('ejgk.fa.em2.oraclecloud.com', 'CX_3')],
  [['oracle'], or('eeho.fa.us2.oraclecloud.com', 'CX_1')],
  [['servicenow'], ats('smartrecruiters', 'servicenow')],
  [['freshworks'], ats('smartrecruiters', 'freshworks')],
  [['databricks'], ats('greenhouse', 'databricks')],
  [['mongodb'], ats('greenhouse', 'mongodb')],
  [['druva'], ats('greenhouse', 'druva')],
  [['snowflake'], ats('ashby', 'snowflake')],
  [['meesho'], ats('lever', 'meesho')],
  [['amazon', 'amazon web services', 'aws'], { type: 'amazon' }]
]

const LOOKUP = new Map<string, Omit<CompanySource, 'detectedAt'>>()
for (const [names, src] of ENTRIES) for (const n of names) LOOKUP.set(n, src)

export function knownSource(name: string): Omit<CompanySource, 'detectedAt'> | undefined {
  const key = name.toLowerCase().trim().replace(/\s+/g, ' ')
  return LOOKUP.get(key) ?? LOOKUP.get(key.replace(/\b(india|pvt|private|ltd|limited|inc|corp|corporation)\b\.?/g, '').trim())
}
