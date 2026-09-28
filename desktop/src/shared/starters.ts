// Suggested watch lists, shown in onboarding and on the Companies tab. Every
// name here resolves through the job-feed registry (src/main/engine/registry.ts),
// so watching them costs nothing.
export const STARTER_GROUPS: { label: string; names: string[] }[] = [
  {
    label: 'AI-first',
    names: ['OpenAI', 'Anthropic', 'Sarvam AI', 'Cohere', 'ElevenLabs', 'Perplexity', 'Scale AI', 'Glean',
      'Observe.AI', 'Deepgram', 'Writer', 'Harvey', 'Sierra', 'Decagon', 'Together AI', 'CoreWeave', 'Cerebras', 'Nvidia']
  },
  {
    label: 'Data & AI platforms',
    names: ['Databricks', 'Snowflake', 'MongoDB', 'Datadog', 'Elastic', 'Confluent', 'Salesforce', 'ServiceNow',
      'Workday', 'Adobe', 'Oracle', 'Amazon', 'Freshworks', 'Druva', 'BrowserStack']
  },
  {
    label: 'Security, infra & payments',
    names: ['Cloudflare', 'Okta', 'Zscaler', 'Rubrik', 'Cisco', 'Twilio', 'Stripe', 'Mastercard', 'GitLab']
  },
  {
    label: 'Services & consulting',
    names: ['Accenture', 'Genpact', 'Kyndryl', 'EY', 'PwC', 'KPMG']
  }
]
