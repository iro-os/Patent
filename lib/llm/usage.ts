import type { SupabaseClient } from '@supabase/supabase-js'
import { costUsd, type UsageRecord } from './pricing'

// Persist one LLM call's measured token usage + computed cost. Telemetry must
// never break a request — failures are swallowed and logged.
export async function recordUsage(
  supabase: SupabaseClient,
  ctx: { projectId: string; operation: string },
  u: UsageRecord,
): Promise<void> {
  try {
    await supabase.from('usage_log').insert({
      project_id: ctx.projectId,
      operation: ctx.operation,
      model: u.model,
      input_tokens: u.input_tokens,
      output_tokens: u.output_tokens,
      cache_creation_input_tokens: u.cache_creation_input_tokens,
      cache_read_input_tokens: u.cache_read_input_tokens,
      cost_usd: Number(costUsd(u).toFixed(6)),
    })
  } catch (e) {
    console.error('usage log failed:', e)
  }
}
