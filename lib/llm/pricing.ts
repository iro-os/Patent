// Anthropic pricing — USD per 1M tokens. Source: claude-api skill (cached 2026-05-26).
// Output is the expensive side; cache reads are ~0.1x input, cache writes (5m) ~1.25x.
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-haiku-4-5': { input: 1, output: 5 },
}
const FALLBACK = { input: 3, output: 15 } // assume Sonnet-class if model unknown

export interface UsageRecord {
  model: string
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

// True cost of a single call, accounting for the cache read/write tiers.
export function costUsd(u: UsageRecord): number {
  const p = PRICES[u.model] ?? FALLBACK
  const per = (tokens: number, ratePerMillion: number) => (tokens / 1_000_000) * ratePerMillion
  return (
    per(u.input_tokens, p.input) +
    per(u.cache_creation_input_tokens, p.input * 1.25) +
    per(u.cache_read_input_tokens, p.input * 0.1) +
    per(u.output_tokens, p.output)
  )
}
