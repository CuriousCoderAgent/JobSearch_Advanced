import type { CompanySource } from '../../shared/types'

// Job feeds for well-known employers, each verified live on 2026-09-28.
// Checked before any discovery, so these companies cost nothing and are
// never mis-identified. Keys are lower-case names/aliases.
const wd = (tenant: string, pod: string, site: string): Omit<CompanySource, 'detectedAt'> =>
  ({ type: 'workday', host: `${tenant}.${pod}.myworkdayjobs.com`, tenant, site })
const sf = (host: string): Omit<CompanySource, 'detectedAt'> => ({ type: 'successfactors', host })
const or = (host: string, siteNumber: string): Omit<CompanySource, 'detectedAt'> => ({ type: 'oracle', host, siteNumber })
const ats = (type: CompanySource['type'], slug: string): Omit<CompanySource, 'detectedAt'> => ({ type, slug })
const portal = (url: string): Omit<CompanySource, 'detectedAt'> => ({ type: 'portal', url })

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
  [['amazon', 'amazon web services', 'aws'], { type: 'amazon' }],

  // AI-first companies (verified 2026-09-28).
  [['openai'], ats('ashby', 'openai')],
  [['anthropic'], ats('greenhouse', 'anthropic')],
  [['sarvam', 'sarvam ai', 'sarvamai', 'sarvam.ai'], ats('ashby', 'sarvam')],
  [['cohere'], ats('ashby', 'cohere')],
  [['elevenlabs', 'eleven labs'], ats('ashby', 'elevenlabs')],
  [['perplexity', 'perplexity ai'], ats('ashby', 'perplexity')],
  [['scale ai', 'scale', 'scaleai'], ats('greenhouse', 'scaleai')],
  [['glean'], ats('greenhouse', 'gleanwork')],
  [['observe.ai', 'observe ai', 'observeai'], ats('greenhouse', 'observeai')],
  [['deepgram'], ats('ashby', 'deepgram')],
  [['writer', 'writer.com'], ats('ashby', 'writer')],
  [['harvey', 'harvey ai'], ats('ashby', 'harvey')],
  [['sierra', 'sierra ai'], ats('ashby', 'sierra')],
  [['decagon'], ats('ashby', 'decagon')],
  [['together ai', 'together.ai', 'togetherai'], ats('greenhouse', 'togetherai')],
  [['coreweave'], ats('greenhouse', 'coreweave')],
  [['cerebras', 'cerebras systems'], ats('ashby', 'cerebras')],
  [['langchain'], ats('ashby', 'langchain')],
  // Verified 2026-10-15.
  [['cursor', 'anysphere', 'cursor ai'], ats('ashby', 'cursor')],
  [['abnormal', 'abnormal ai', 'abnormal security', 'abnormalsecurity'], ats('greenhouse', 'abnormalsecurity')],

  // Tech-led platforms with India enterprise teams (verified 2026-09-28).
  [['datadog'], ats('greenhouse', 'datadog')],
  [['elastic'], ats('greenhouse', 'elastic')],
  [['confluent'], ats('ashby', 'confluent')],
  [['cloudflare'], ats('greenhouse', 'cloudflare')],
  [['okta'], ats('greenhouse', 'okta')],
  [['zscaler'], ats('greenhouse', 'zscaler')],
  [['rubrik'], ats('greenhouse', 'rubrik')],
  [['twilio'], ats('greenhouse', 'twilio')],
  [['stripe'], ats('greenhouse', 'stripe')],
  [['gitlab'], ats('greenhouse', 'gitlab')],
  [['intercom'], ats('greenhouse', 'intercom')],
  [['mindtickle'], ats('lever', 'mindtickle')],

  // Added 2026-10-19, each checked against live jobs for the right company.
  // IT services (SuccessFactors career sites).
  [['capgemini', 'capgemini india'], sf('careers.capgemini.com')],
  [['hcltech', 'hcl tech', 'hcl technologies', 'hcl'], sf('careers.hcltech.com')],
  [['wipro'], sf('careers.wipro.com')],
  // AI-native and tech-led companies hiring for GTM.
  [['wiz'], ats('greenhouse', 'wizinc')],
  [['sprinklr'], wd('sprinklr', 'wd1', 'careers')],
  [['uniphore'], wd('uniphore', 'wd503', 'Uniphore')],
  [['gong', 'gong.io'], ats('greenhouse', 'gongio')],
  [['harness', 'harness.io'], ats('greenhouse', 'harnessinc')],
  [['vercel'], ats('greenhouse', 'vercel')],
  [['replit'], ats('ashby', 'replit')],
  [['clay', 'clay labs'], ats('ashby', 'claylabs')],
  [['hebbia'], ats('ashby', 'hebbia-ai')],
  [['synthesia'], ats('ashby', 'synthesia')],
  [['postman'], wd('postman', 'wd108', 'careers')],
  [['mistral', 'mistral ai', 'mistralai', 'mistral.ai'], ats('ashby', 'mistral.ai')],
  [['rippling'], { type: 'rippling', slug: 'rippling' }],
  [['atlassian'], { type: 'atlassian' }],
  [['deloitte', 'deloitte india', 'deloitte south asia'], sf('southasiacareers.deloitte.com')],
  [['hexaware', 'hexaware technologies'], or('fa-etqo-saasfaprod1.fa.ocs.oraclecloud.com', 'CX_1')],
  // Bootstrapped.
  [['surge ai', 'surge', 'surgehq'], ats('ashby', 'surge-ai')],
  [['zapier'], ats('ashby', 'zapier')],
  [['midjourney'], ats('ashby', 'midjourney')],

  // Closed job portals with no free feed (Taleo, iCIMS, Avature, RippleHire,
  // Zwayam, Zoho Recruit, in-house). Listed so the radar links straight to
  // them, and so a guessed slug can't match a different company (Greenhouse
  // "tcs" and "sas" are other firms).
  [['tcs', 'tata consultancy services'], portal('https://www.tcs.com/careers')],
  [['cognizant'], portal('https://careers.cognizant.com/india-en/jobs/')],
  [['infosys'], portal('https://career.infosys.com/joblist')],
  [['tech mahindra', 'techmahindra'], portal('https://careers.techmahindra.com/CurrentOpportunity.aspx')],
  [['ltimindtree', 'lti mindtree'], portal('https://www.ltimindtree.com/careers/')],
  [['ibm'], portal('https://www.ibm.com/careers/search')],
  [['sas', 'sas institute'], portal('https://globalcareers-sas.icims.com/jobs/intro')],
  [['persistent', 'persistent systems'], portal('https://careers.persistent.com/')],
  [['mphasis'], portal('https://careers.mphasis.com/')],
  [['coforge'], portal('https://careers.coforge.com/coforge/')],
  [['yellow.ai', 'yellow ai', 'yellowai'], portal('https://careers.yellow.ai/jobs/Careers')],
  [['gupshup'], portal('https://www.gupshup.ai/careers')],
  [['zoho', 'zoho corporation'], portal('https://careers.zohocorp.com/jobs/Careers')],
  [['zerodha'], portal('https://careers.zerodha.com/')],
  [['hugging face', 'huggingface'], portal('https://apply.workable.com/huggingface/')]
]

const LOOKUP = new Map<string, Omit<CompanySource, 'detectedAt'>>()
for (const [names, src] of ENTRIES) for (const n of names) LOOKUP.set(n, src)

export function knownSource(name: string): Omit<CompanySource, 'detectedAt'> | undefined {
  const key = name.toLowerCase().trim().replace(/\s+/g, ' ')
  return LOOKUP.get(key) ?? LOOKUP.get(key.replace(/\b(india|pvt|private|ltd|limited|inc|corp|corporation)\b\.?/g, '').trim())
}
