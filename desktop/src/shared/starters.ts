// Suggested watch lists, shown in onboarding and on the Companies tab. Every
// name here resolves through the job-feed registry (src/main/engine/registry.ts),
// so watching them costs nothing.
export const STARTER_GROUPS: { label: string; names: string[] }[] = [
  {
    label: 'AI-first',
    names: ['OpenAI', 'Anthropic', 'Sarvam AI', 'Cohere', 'ElevenLabs', 'Perplexity', 'Scale AI', 'Glean',
      'Observe.AI', 'Deepgram', 'Writer', 'Harvey', 'Sierra', 'Decagon', 'Together AI', 'CoreWeave', 'Cerebras', 'Nvidia',
      'Cursor', 'LangChain', 'Abnormal AI', 'Mistral AI', 'Hebbia', 'Synthesia', 'Replit', 'Clay', 'Uniphore']
  },
  {
    label: 'Data & AI platforms',
    names: ['Databricks', 'Snowflake', 'MongoDB', 'Datadog', 'Elastic', 'Confluent', 'Salesforce', 'ServiceNow',
      'Workday', 'Adobe', 'Oracle', 'Amazon', 'Freshworks', 'Druva', 'BrowserStack', 'Atlassian', 'Rippling', 'Postman',
      'Sprinklr', 'Gong', 'Vercel', 'Harness', 'UiPath']
  },
  {
    label: 'Security, infra & payments',
    names: ['Cloudflare', 'Okta', 'Zscaler', 'Rubrik', 'Wiz', 'Cisco', 'Twilio', 'Stripe', 'Mastercard', 'GitLab']
  },
  {
    label: 'Services & consulting',
    names: ['Accenture', 'Capgemini', 'HCLTech', 'Wipro', 'Deloitte', 'Hexaware', 'Genpact', 'Kyndryl', 'EY', 'PwC', 'KPMG']
  },
  {
    label: 'Fast growers (valuation up several-fold since 2024)',
    names: ['Cognition', 'Wonderful', 'Temporal', 'ClickHouse', 'Saviynt', 'Chainguard', 'Grafana Labs', 'Airwallex',
      'Rogo', 'Legora', 'Lovable', 'Supabase', 'Fireworks AI', 'Baseten', 'Island', 'Vanta', 'n8n', 'Genspark', 'Parloa',
      'Cato Networks', 'Zeta']
  },
  {
    label: 'AI for sales & marketing',
    names: ['Outreach', 'Profound', 'Nooks', 'Monaco', 'Attio', 'Rox', 'Hightouch', 'Lightfield', 'Artisan', 'Conversion',
      'Siro', 'Starbridge', 'Agentio', 'Alembic', 'Attention', 'Brandlight', 'CreatorIQ', 'Nectar', 'Rilla', 'Aligned',
      'Bluefish', 'Forma.ai', 'Gradial', 'Levitate', 'BrightEdge']
  },
  {
    label: 'Enterprise software & security (paths to Salesforce / ServiceNow)',
    names: ['SAP', 'Broadcom', 'Red Hat', 'Palo Alto Networks', 'CrowdStrike', 'Check Point', 'Fortinet', 'F5', 'SentinelOne',
      'Netskope', 'Zendesk', 'Genesys', 'NICE', 'HubSpot', 'Qualtrics', 'Pure Storage', 'Commvault', 'Icertis', 'Computacenter']
  },
  {
    label: 'Bootstrapped & profitable',
    names: ['Surge AI', 'Midjourney', 'Zapier']
  }
]

// AI-first and fast-growing companies. Here a senior enterprise AE seat, or a
// startup's first India sales lead, is a real step up, so the job screen keeps
// those roles too (elsewhere it wants director level and above).
const HIGH_GROWTH_GROUPS = ['AI-first', 'Fast growers', 'AI for sales']
export const HIGH_GROWTH = new Set(
  STARTER_GROUPS.filter((g) => HIGH_GROWTH_GROUPS.some((p) => g.label.startsWith(p))).flatMap((g) => g.names.map((n) => n.toLowerCase()))
)
export const isHighGrowth = (company: string): boolean => HIGH_GROWTH.has(company.trim().toLowerCase())
