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
      'Sprinklr', 'Gong', 'Vercel', 'Harness']
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
    label: 'Bootstrapped & profitable',
    names: ['Surge AI', 'Midjourney', 'Zapier']
  }
]
