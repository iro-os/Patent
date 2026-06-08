import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { DraftPane } from '@/app/_components/draft-pane'
import { Panes } from '@/app/_components/panes'
import { Workspace } from './workspace'

export const dynamic = 'force-dynamic'

// Auth is enforced by the (app) layout. RLS guarantees a user can only read their
// own project, so a missing row here means not-found (or not-owned).
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase.from('projects').select('*').eq('id', id).single()
  if (!project) notFound()

  const [messagesRes, disclosureRes, refsRes, coverageRes, diffRes, devRes, claimRes, usageRes] =
    await Promise.all([
      supabase
        .from('messages')
        .select('id, role, kind, content, data, created_at')
        .eq('project_id', id)
        .order('created_at'),
      supabase
        .from('disclosure_check')
        .select('disclosed, disclosure_date')
        .eq('project_id', id)
        .maybeSingle(),
      supabase
        .from('prior_art_refs')
        .select('id, source, url, pub_date, lang, title, ko_summary, abstract, similarity')
        .eq('project_id', id)
        .order('similarity', { ascending: false, nullsFirst: false }),
      supabase.from('coverage_report').select('*').eq('project_id', id).maybeSingle(),
      supabase.from('differentiation_points').select('point').eq('project_id', id).order('created_at'),
      supabase
        .from('develop_suggestions')
        .select('suggestion, kind, rationale')
        .eq('project_id', id)
        .order('created_at'),
      supabase
        .from('claim_strategy')
        .select('independent_scope, dependent_ladder')
        .eq('project_id', id)
        .maybeSingle(),
      supabase
        .from('usage_log')
        .select('cost_usd, input_tokens, output_tokens, cache_read_input_tokens')
        .eq('project_id', id),
    ])

  const refs = refsRes.data ?? []

  // Measured AI spend for this project (real cost, not an estimate).
  const usageRows = usageRes.data ?? []
  const usage = usageRows.length
    ? { cost: usageRows.reduce((s, r) => s + Number(r.cost_usd), 0), calls: usageRows.length }
    : null

  // key={id} so the middle/right panes get fresh local state per invention while the
  // sidebar (in the layout) stays mounted — no cross-project state bleed, no flicker.
  return (
    <Panes
      middle={
        <Workspace
          key={id}
          projectId={id}
          messages={messagesRes.data ?? []}
          refs={refs}
          coverage={coverageRes.data}
          disclosure={disclosureRes.data}
          usage={usage}
        />
      }
      right={
        <DraftPane
          key={id}
          projectId={id}
          project={{ title: project.title, status: project.status }}
          refsCount={refs.length}
          claimStrategy={claimRes.data}
          differentiation={diffRes.data ?? []}
          develop={devRes.data ?? []}
          disclosure={disclosureRes.data}
        />
      }
    />
  )
}
