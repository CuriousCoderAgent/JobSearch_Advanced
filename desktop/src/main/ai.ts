import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { z } from 'zod'
import { getApiKey } from './secrets'
import { read, update, nowIso } from './store'
import type { Settings, UsageEntry } from '../shared/types'

// Coaching, critiques and tailoring use the strongest model. Bulk job parsing
// (reading careers pages, judging relevance of new listings) uses Haiku 4.5 —
// you asked for the job engine to be as cheap as possible.
export const COACH_MODEL = 'claude-opus-5'
export const BULK_MODEL = 'claude-haiku-4-5'
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

// USD per million tokens (input, output, cache read, cache write).
const PRICES: Record<string, [number, number, number, number]> = {
  'claude-opus-5': [5, 25, 0.5, 6.25],
  'claude-opus-4-8': [5, 25, 0.5, 6.25],
  'claude-sonnet-5': [2, 10, 0.2, 2.5],
  'claude-haiku-4-5': [1, 5, 0.1, 1.25]
}
const WEB_SEARCH_USD = 0.01

export class AiError extends Error {}

function client(): Anthropic {
  const apiKey = getApiKey()
  if (!apiKey) throw new AiError('Add your Anthropic API key in Settings to use AI features.')
  return new Anthropic({ apiKey, maxRetries: 2 })
}

export function monthSpend(): number {
  const month = new Date().toISOString().slice(0, 7)
  return read<UsageEntry[]>('usage', [])
    .filter((u) => u.at.startsWith(month))
    .reduce((sum, u) => sum + u.costUsd, 0)
}

function checkBudget(): void {
  const { monthlyBudgetUsd } = read<Partial<Settings>>('settings', {})
  if (monthlyBudgetUsd && monthlyBudgetUsd > 0 && monthSpend() >= monthlyBudgetUsd) {
    throw new AiError(`Monthly AI budget of $${monthlyBudgetUsd} reached. Raise it in Settings to continue.`)
  }
}

interface UsageLike {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
  server_tool_use?: { web_search_requests?: number } | null
}

function logUsage(feature: string, model: string, usage: UsageLike): void {
  const [pin, pout, pcr, pcw] = PRICES[model] ?? PRICES[COACH_MODEL]
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const webSearches = usage.server_tool_use?.web_search_requests ?? 0
  const costUsd =
    (usage.input_tokens * pin + usage.output_tokens * pout + cacheRead * pcr + cacheWrite * pcw) / 1e6 +
    webSearches * WEB_SEARCH_USD
  const entry: UsageEntry = {
    at: nowIso(), feature, model,
    inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
    cacheRead, cacheWrite, webSearches, costUsd
  }
  update<UsageEntry[]>('usage', [], (list) => [...list, entry].slice(-5000))
}

function friendly(err: unknown): Error {
  if (err instanceof AiError) return err
  if (err instanceof Anthropic.AuthenticationError) return new AiError('Your Anthropic API key was rejected. Check it in Settings.')
  if (err instanceof Anthropic.PermissionDeniedError) return new AiError('This API key does not have access to that model.')
  if (err instanceof Anthropic.RateLimitError) return new AiError('Anthropic rate limit hit. Wait a minute and try again.')
  if (err instanceof Anthropic.BadRequestError) return new AiError(`Request rejected: ${err.message}`)
  if (err instanceof Anthropic.APIConnectionError) return new AiError('Could not reach Anthropic. Check your internet connection.')
  if (err instanceof Anthropic.APIError) return new AiError(`Anthropic API error ${err.status}: ${err.message}`)
  return err instanceof Error ? err : new Error(String(err))
}

type SystemBlocks = Anthropic.Beta.BetaTextBlockParam[]
const cachedSystem = (text: string): SystemBlocks => [{ type: 'text', text, cache_control: { type: 'ephemeral' } }]

// One structured-output call on the coach model, streamed so long outputs
// (a full tailored CV) never hit request timeouts. Server-side fallbacks are
// on, so a rare classifier decline is retried on Anthropic's recommended model.
export async function coachParse<S extends z.ZodType>(
  feature: string,
  opts: {
    system: string
    content: Anthropic.Beta.BetaContentBlockParam[] | string
    schema: S
    effort?: 'low' | 'medium' | 'high' | 'xhigh'
    maxTokens?: number
  }
): Promise<z.infer<S>> {
  checkBudget()
  try {
    const res = await client().beta.messages.stream({
      model: COACH_MODEL,
      max_tokens: opts.maxTokens ?? 16000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      system: cachedSystem(opts.system),
      output_config: { effort: opts.effort ?? 'high', format: betaZodOutputFormat(opts.schema) },
      messages: [{ role: 'user', content: opts.content }]
    }).finalMessage()
    logUsage(feature, res.model, res.usage)
    if (res.stop_reason === 'refusal') throw new AiError('Claude declined this request. Try rephrasing it.')
    if (res.stop_reason === 'max_tokens') throw new AiError('The response ran too long. Try again with a shorter input.')
    if (!res.parsed_output) throw new AiError('Claude returned an unexpected format. Please try again.')
    return res.parsed_output as z.infer<S>
  } catch (err) {
    throw friendly(err)
  }
}

// Streaming chat on the coach model. Calls onText for each text delta.
export async function coachStream(
  feature: string,
  opts: { system: string; messages: Anthropic.Beta.BetaMessageParam[]; onText: (delta: string) => void }
): Promise<string> {
  checkBudget()
  try {
    const stream = client().beta.messages.stream({
      model: COACH_MODEL,
      max_tokens: 32000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system: cachedSystem(opts.system),
      messages: opts.messages
    })
    stream.on('text', (delta) => opts.onText(delta))
    const final = await stream.finalMessage()
    logUsage(feature, final.model, final.usage)
    if (final.stop_reason === 'refusal') throw new AiError('Claude declined to answer that. Try rephrasing.')
    return final.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
  } catch (err) {
    throw friendly(err)
  }
}

// Cheap structured extraction for the job engine.
export async function bulkParse<S extends z.ZodType>(
  feature: string,
  opts: { system: string; content: string; schema: S; maxTokens?: number }
): Promise<z.infer<S>> {
  checkBudget()
  try {
    const res = await client().messages.parse({
      model: BULK_MODEL,
      max_tokens: opts.maxTokens ?? 8000,
      system: opts.system,
      output_config: { format: zodOutputFormat(opts.schema) },
      messages: [{ role: 'user', content: opts.content }]
    })
    logUsage(feature, res.model, res.usage)
    if (!res.parsed_output) throw new AiError('Unexpected response while reading jobs.')
    return res.parsed_output as z.infer<S>
  } catch (err) {
    throw friendly(err)
  }
}

// One cheap web search (Haiku 4.5 + basic web search). Used once per company,
// ever, to find a careers page when it can't be found for free.
export async function bulkSearchText(feature: string, prompt: string): Promise<string> {
  checkBudget()
  try {
    const res = await client().messages.create({
      model: BULK_MODEL,
      max_tokens: 1024,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }],
      messages: [{ role: 'user', content: prompt }]
    })
    logUsage(feature, res.model, res.usage)
    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
  } catch (err) {
    throw friendly(err)
  }
}
