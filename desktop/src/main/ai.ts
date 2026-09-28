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

// USD per million tokens (input, output, cache read, cache write). Responses
// can name a dated snapshot ("claude-haiku-4-5-20251001") or a fallback model,
// so prices are matched by prefix.
const PRICES: Record<string, [number, number, number, number]> = {
  'claude-opus-5': [5, 25, 0.5, 6.25],
  'claude-opus-4': [5, 25, 0.5, 6.25],
  'claude-fable-5': [10, 50, 1, 12.5],
  'claude-sonnet-5': [2, 10, 0.2, 2.5],
  'claude-sonnet-4': [3, 15, 0.3, 3.75],
  'claude-haiku-4-5': [1, 5, 0.1, 1.25]
}
const WEB_SEARCH_USD = 0.01

function priceOf(model: string): [number, number, number, number] {
  const key = Object.keys(PRICES).sort((a, b) => b.length - a.length).find((k) => model.startsWith(k))
  return PRICES[key ?? COACH_MODEL]
}

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

export function costOf(u: Omit<UsageEntry, 'costUsd' | 'at' | 'feature'>): number {
  const [pin, pout, pcr, pcw] = priceOf(u.model)
  return (u.inputTokens * pin + u.outputTokens * pout + u.cacheRead * pcr + u.cacheWrite * pcw) / 1e6 + u.webSearches * WEB_SEARCH_USD
}

function logUsage(feature: string, model: string, usage: UsageLike): void {
  const counts = {
    model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
    webSearches: usage.server_tool_use?.web_search_requests ?? 0
  }
  const entry: UsageEntry = { at: nowIso(), feature, ...counts, costUsd: costOf(counts) }
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

// A client-side tool the coach can call mid-conversation (e.g. saving a memory).
export interface CoachTool {
  name: string
  description: string
  inputSchema: Anthropic.Beta.BetaTool.InputSchema
  validate: z.ZodType
  run: (input: never) => string | Promise<string>
}

// Streaming chat on the coach model. Calls onText for each text delta and
// runs any tools the coach calls, looping until it has finished its reply.
export async function coachStream(
  feature: string,
  opts: { system: string; messages: Anthropic.Beta.BetaMessageParam[]; onText: (delta: string) => void; tools?: CoachTool[] }
): Promise<string> {
  checkBudget()
  const tools = opts.tools ?? []
  const toolDefs: Anthropic.Beta.BetaTool[] = tools.map((t) => ({
    name: t.name, description: t.description, input_schema: t.inputSchema, eager_input_streaming: true
  }))
  const messages = [...opts.messages]
  let reply = ''
  let jsonRetries = 0
  try {
    for (let turn = 0; turn < 8; turn++) {
      const stream = client().beta.messages.stream({
        model: COACH_MODEL,
        max_tokens: 32000,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system: cachedSystem(opts.system),
        ...(toolDefs.length ? { tools: toolDefs } : {}),
        messages
      })
      // Text after a tool call continues the same reply on a new paragraph.
      let first = true
      stream.on('text', (delta) => {
        if (first && reply) opts.onText('\n\n')
        first = false
        opts.onText(delta)
      })
      let final: Anthropic.Beta.BetaMessage
      try {
        final = await stream.finalMessage()
        jsonRetries = 0
      } catch (err) {
        // With eager input streaming, an unparseable tool input rejects here;
        // re-issue that turn a couple of times. API errors go to the user.
        if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err
        continue
      }
      logUsage(feature, final.model, final.usage)
      if (final.stop_reason === 'refusal') throw new AiError('Claude declined to answer that. Try rephrasing.')
      const text = final.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
      if (text) reply = reply ? `${reply}\n\n${text}` : text
      if (final.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: final.content }); continue }
      const uses = final.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
      if (final.stop_reason !== 'tool_use' || !uses.length) break

      messages.push({ role: 'assistant', content: final.content })
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
      for (const use of uses) {
        const tool = tools.find((t) => t.name === use.name)
        const parsed = tool?.validate.safeParse(use.input)
        if (!tool || !parsed?.success) {
          results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: `Invalid input for ${use.name}.` })
          continue
        }
        try {
          results.push({ type: 'tool_result', tool_use_id: use.id, content: await tool.run(parsed.data as never) })
        } catch (e) {
          results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: (e as Error).message })
        }
      }
      messages.push({ role: 'user', content: results })
    }
    return reply
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
