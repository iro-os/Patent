import Anthropic from '@anthropic-ai/sdk'
import type { UsageRecord } from './pricing'

// Opus 4.8 by default — the product writes 변리사-ready legal text, so output quality is
// the north star (claude-api guidance also defaults to opus for substantive work). Override
// with PATENT_AI_MODEL (e.g. claude-sonnet-4-6) for cheaper dev/testing. Stays swappable.
export const MODEL = process.env.PATENT_AI_MODEL || 'claude-opus-4-8'

// Thrown when the Anthropic key is absent, so routes can return a friendly message
// instead of a 500. The free retrieval path (PubMed/OpenAlex) works without a key.
export class MissingKeyError extends Error {
  constructor(public key: string) {
    super(`${key} is not configured`)
    this.name = 'MissingKeyError'
  }
}

let client: Anthropic | null = null

export function getAnthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new MissingKeyError('ANTHROPIC_API_KEY')
  // Confidentiality: the Anthropic API does not train on API inputs/outputs by default,
  // and that no-train default + per-user RLS is what protects the unpublished invention
  // data we send. Zero Data Retention (ZDR) is NOT enabled yet (deferred for MVP); enable
  // it at the org level before handling stricter data. Never route payloads to a
  // training-enabled endpoint.
  if (!client) client = new Anthropic({ apiKey })
  return client
}

// Forces a single tool call so the model returns structured JSON matching `inputSchema`.
// This is far more reliable than parsing free-text JSON from the model.
export async function runTool<T>(opts: {
  system: string
  // Provide EITHER a single user string OR a full multi-turn message list (for chat).
  user?: string
  messages?: Anthropic.MessageParam[]
  toolName: string
  toolDescription: string
  inputSchema: Anthropic.Tool['input_schema']
  maxTokens?: number
  // Reasoning depth/spend (GA on Opus 4.6+ / Sonnet 4.6). Default 'high' for filing-grade
  // output; callers may lower it for cheap calls (summaries → 'medium'). 'max' is Opus-tier.
  effort?: 'low' | 'medium' | 'high' | 'max'
  // Dynamic, per-request context appended as a SECOND system block (never cached,
  // since it changes every turn). Used by chat to make the model aware of the
  // persisted project state (prior-art results, analysis) so it never claims work
  // that was actually done "wasn't done".
  systemContext?: string
  // Telemetry: invoked with the call's measured token usage (auto cost logging).
  onUsage?: (usage: UsageRecord) => void | Promise<void>
  // Cache the tools+system prefix (default true). Prefix-match caching only fires
  // once that prefix exceeds the model's minimum (~2048 Sonnet / ~4096 Opus), so
  // it's a no-op on today's small prompts and pays off as prompts grow (Phase 2).
  cachePrompt?: boolean
}): Promise<T> {
  const anthropic = getAnthropic()
  const system: Anthropic.TextBlockParam[] = [
    opts.cachePrompt === false
      ? { type: 'text', text: opts.system }
      : { type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } },
  ]
  // Append the dynamic project-state context as its own uncached block.
  if (opts.systemContext?.trim()) {
    system.push({ type: 'text', text: opts.systemContext })
  }

  const messages: Anthropic.MessageParam[] =
    opts.messages ?? [{ role: 'user', content: opts.user ?? '' }]

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 2048,
    // `effort` tunes reasoning depth/spend (GA on Opus 4.6+ / Sonnet 4.6); 'high' is the
    // quality default for legal drafting. We deliberately do NOT set `thinking` here:
    // adaptive thinking 400s when tool_choice forces a tool ("Thinking may not be enabled
    // when tool_choice forces tool use" — verified against the live API 2026-06-11), and
    // runTool relies on forced tool use for reliable structured JSON. To use thinking,
    // migrate this call to messages.parse / output_config.format instead.
    output_config: { effort: opts.effort ?? 'high' },
    system,
    messages,
    tools: [
      { name: opts.toolName, description: opts.toolDescription, input_schema: opts.inputSchema },
    ],
    tool_choice: { type: 'tool', name: opts.toolName },
  })

  if (opts.onUsage) {
    const u = res.usage
    await opts.onUsage({
      model: res.model,
      input_tokens: u.input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
    })
  }

  // If generation hit the token ceiling mid-tool_use, the SDK still returns a
  // tool_use block but its `input` is truncated (missing/half-written fields).
  // Fail loudly instead of silently persisting a corrupt structured result.
  if (res.stop_reason === 'max_tokens') {
    throw new Error(`LLM output truncated at max_tokens (${opts.toolName}); raise maxTokens`)
  }

  const block = res.content.find((b) => b.type === 'tool_use')
  if (!block || block.type !== 'tool_use') {
    throw new Error('Model did not return a tool_use block')
  }
  return block.input as T
}
