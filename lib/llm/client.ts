import Anthropic from '@anthropic-ai/sdk'

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
  user: string
  toolName: string
  toolDescription: string
  inputSchema: Anthropic.Tool['input_schema']
  maxTokens?: number
}): Promise<T> {
  const anthropic = getAnthropic()
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 2048,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
    tools: [
      { name: opts.toolName, description: opts.toolDescription, input_schema: opts.inputSchema },
    ],
    tool_choice: { type: 'tool', name: opts.toolName },
  })
  const block = res.content.find((b) => b.type === 'tool_use')
  if (!block || block.type !== 'tool_use') {
    throw new Error('Model did not return a tool_use block')
  }
  return block.input as T
}
