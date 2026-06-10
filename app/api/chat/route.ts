import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { chatTurn, type ChatRole, type ChatContext } from '@/lib/llm/chat'
import { MissingKeyError } from '@/lib/llm/client'
import { recordUsage } from '@/lib/llm/usage'
import { must, PersistError } from '@/lib/db'
import { regenerateSection } from '@/lib/spec/section'
import { KIPO_SECTION_KEYS } from '@/lib/kipo/sections'

export const runtime = 'nodejs'
export const maxDuration = 60

// One conversational turn in an invention's thread. Persists the user message, calls
// Claude with the prior thread + the persisted project state (so it is aware of any
// prior research/analysis), refreshes the structured debrief (drives the draft +
// prior-art search), persists the assistant reply, and returns it.
export async function POST(req: Request) {
  let body: { projectId?: string; message?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { projectId, message } = body
  if (!projectId || !message?.trim()) {
    return NextResponse.json({ error: 'projectId와 메시지가 필요합니다.' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: project } = await supabase
    .from('projects')
    .select('id, status')
    .eq('id', projectId)
    .single()
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  // Prior thread + persisted project state, in parallel. The state is what makes the
  // assistant aware of work already done (prior-art results, analysis) so it never
  // claims "no research was performed" when results actually exist.
  const [priorRes, debriefRes, refsRes, refsCountRes, coverageRes, claimRes, diffRes, sectionsRes] =
    await Promise.all([
      supabase
        .from('messages')
        .select('role, content, kind')
        .eq('project_id', projectId)
        .order('created_at'),
      supabase
        .from('debrief')
        .select('title_guess, tech_summary, problem, differentiators, missing_items')
        .eq('project_id', projectId)
        .maybeSingle(),
      supabase
        .from('prior_art_refs')
        .select('title, pub_date, source, ko_summary')
        .eq('project_id', projectId)
        .order('similarity', { ascending: false, nullsFirst: false })
        .order('id', { ascending: true })
        .limit(8),
      supabase
        .from('prior_art_refs')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId),
      supabase
        .from('coverage_report')
        .select('sources_searched, blind_spots')
        .eq('project_id', projectId)
        .maybeSingle(),
      supabase.from('claim_strategy').select('independent_scope').eq('project_id', projectId).maybeSingle(),
      supabase.from('differentiation_points').select('point').eq('project_id', projectId).order('created_at'),
      supabase.from('spec_sections').select('schema_key, generated_text').eq('project_id', projectId),
    ])

  const history = (priorRes.data ?? [])
    .filter((m) => m.kind === 'text' && m.content)
    .map((m) => ({ role: m.role as ChatRole, content: m.content }))

  const topRefs = refsRes.data ?? []
  const refsTotal = refsCountRes.count ?? topRefs.length
  const diffPoints = (diffRes.data ?? []).map((d) => d.point).filter(Boolean)
  const claimScope = claimRes.data?.independent_scope ?? null

  const context: ChatContext = {
    debrief: debriefRes.data
      ? {
          title_guess: debriefRes.data.title_guess,
          tech_summary: debriefRes.data.tech_summary,
          problem: debriefRes.data.problem,
          differentiators: debriefRes.data.differentiators,
          missing_items: (debriefRes.data.missing_items as string[] | null) ?? [],
        }
      : null,
    research:
      refsTotal > 0
        ? {
            count: refsTotal,
            sources: (
              (coverageRes.data?.sources_searched as { source: string }[] | null) ?? []
            ).map((s) => s.source),
            refs: topRefs.map((r) => ({
              title: r.title,
              year: r.pub_date ? r.pub_date.slice(0, 4) : null,
              source: r.source,
              ko_summary: r.ko_summary,
            })),
            blind_spots: (coverageRes.data?.blind_spots as string[] | null) ?? [],
          }
        : null,
    analysis:
      claimScope || diffPoints.length > 0
        ? { independent_scope: claimScope, differentiators: diffPoints }
        : null,
    generated_sections: (sectionsRes.data ?? [])
      .filter((s) => s.generated_text)
      .map((s) => s.schema_key),
  }

  // Persist the user message FIRST so the turn is durable. If the user navigates away
  // while the model is generating, the message is not lost — the route still runs to
  // completion server-side, and any client viewing the session detects the pending
  // (unanswered) user turn and polls for the reply. This is what makes in-flight
  // processing resilient to navigation.
  const { data: userRow, error: userErr } = await supabase
    .from('messages')
    .insert({ project_id: projectId, role: 'user', kind: 'text', content: message })
    .select('id')
    .single()
  if (userErr || !userRow) {
    console.error('chat user-message insert failed:', userErr?.message)
    return NextResponse.json({ error: 'persist_failed' }, { status: 500 })
  }

  let turn
  try {
    turn = await chatTurn({ history, userMessage: message, context }, (u) =>
      recordUsage(supabase, { projectId, operation: 'chat' }, u),
    )
  } catch (e) {
    // Leave the user message persisted (input preserved); the turn is simply left
    // unanswered and the user can retry by sending again.
    if (e instanceof MissingKeyError) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY_MISSING', message: 'Anthropic API 키가 설정되지 않았습니다.' },
        { status: 400 },
      )
    }
    console.error('chat failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'chat_failed' }, { status: 500 })
  }

  const u = turn.understanding
  let assistant: { id: string; role: string; kind: string; content: string; created_at: string }
  try {
    // Refresh the debrief, then persist the assistant turn.
    must(
      await supabase.from('debrief').upsert(
        {
          project_id: projectId,
          title_guess: u.title_guess,
          tech_summary: u.tech_summary,
          problem: u.problem,
          differentiators: u.differentiators,
          ipc_candidates: u.ipc_candidates,
          missing_items: u.missing_items,
          search_query_en: u.search_query_en,
          search_concepts: u.search_concepts,
        },
        { onConflict: 'project_id' },
      ),
      'debrief upsert',
    )

    const { data: inserted, error: insErr } = await supabase
      .from('messages')
      .insert({ project_id: projectId, role: 'assistant', kind: 'text', content: turn.reply_ko })
      .select('id, role, kind, content, created_at')
      .single()
    if (insErr || !inserted) throw new PersistError('assistant message insert', insErr?.message)
    assistant = inserted

    // Keep the title fresh. Only promote status out of the initial intake stage —
    // never downgrade a project that has already moved past it (e.g. research done),
    // otherwise chatting would flip the sidebar back to "리서치 대기".
    const update: { title: string; status?: string } = {
      title: u.title_guess || '제목 없는 발명',
    }
    if (project.status === 'draft_intake') update.status = 'ready'
    must(await supabase.from('projects').update(update).eq('id', projectId), 'project update')
  } catch (e) {
    if (e instanceof PersistError) return NextResponse.json({ error: 'persist_failed' }, { status: 500 })
    console.error('chat persist failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'persist_failed' }, { status: 500 })
  }

  // Chat-driven section edit (P0-A): if the model identified a target section, regenerate
  // just that one with the same grounded service as the right-pane button. Best-effort —
  // an edit failure must not fail the chat turn (the assistant reply is already persisted).
  // Gate to sections that ALREADY have body text — chat editing must change an existing
  // section, never silently create a brand-new one (spec: "그 섹션만 바뀌고").
  const generatedSet = new Set(
    (sectionsRes.data ?? []).filter((s) => s.generated_text).map((s) => s.schema_key),
  )
  let editedSection: string | null = null
  if (
    turn.section_edit &&
    KIPO_SECTION_KEYS.includes(turn.section_edit.schema_key) &&
    generatedSet.has(turn.section_edit.schema_key)
  ) {
    try {
      await regenerateSection(
        supabase,
        projectId,
        turn.section_edit.schema_key,
        turn.section_edit.instruction || null,
      )
      editedSection = turn.section_edit.schema_key
    } catch (e) {
      console.error('chat section edit failed (non-fatal):', e instanceof Error ? e.message : e)
    }
  }

  return NextResponse.json({
    message: assistant,
    ready_for_research: turn.ready_for_research,
    edited_section: editedSection,
  })
}
