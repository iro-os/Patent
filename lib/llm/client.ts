import Anthropic from '@anthropic-ai/sdk'
import type { UsageRecord } from './pricing'

// Default model is Sonnet for dev/testing (cost control). Opus is reserved for
// production-quality drafting. Configured via PATENT_AI_MODEL so the model stays
// swappable (consensus plan: model-agnostic config).
export const MODEL = process.env.PATENT_AI_MODEL || 'claude-sonnet-4-6'

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
  // Confidentiality (consensus plan invariant): the Anthropic API does not train on
  // API inputs/outputs by default. For unpublished invention data, enable Zero Data
  // Retention at the org level and never route payloads to a training-enabled endpoint.
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
