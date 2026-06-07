import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateDifferentiation, type RefItem } from '@/lib/llm/analyze'
import { MissingKeyError } from '@/lib/llm/client'
import { isAllowedRef, allowedRefNumbers } from '@/lib/llm/grounding'
import { recordUsage } from '@/lib/llm/usage'
import { must, PersistError } from '@/lib/db'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_REFS = 15 // bound the analysis prompt size

export async function POST(req: Request) {
  let body: { projectId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { projectId } = body
  if (!projectId) return NextResponse.json({ error: 'projectId가 필요합니다.' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: debrief } = await supabase
    .from('debrief')
    .select('title_guess, tech_summary, problem, differentiators')
    .eq('project_id', projectId)
    .single()
  if (!debrief) {
    return NextResponse.json(
      { error: 'no_debrief', message: '먼저 아이디어 디브리프를 완료하세요.' },
      { status: 400 },
    )
  }

  const { data: refs } = await supabase
    .from('prior_art_refs')
    .select('id, title, abstract, ko_summary, pub_date, similarity')
    .eq('project_id', projectId)
    .order('similarity', { ascending: false, nullsFirst: false })
    .limit(MAX_REFS)
  if (!refs || refs.length === 0) {
    return NextResponse.json(
      { error: 'no_refs', message: '먼저 선행기술 검색을 실행하세요.' },
      { status: 400 },
    )
  }

  // Build the closed allow-list: number -> ref id.
  const idByN = new Map<number, string>()
  const items: RefItem[] = refs.map((r, i) => {
    const n = i + 1
    idByN.set(n, r.id)
    const snippet = (r.ko_summary || r.abstract || '').replace(/\s+/g, ' ').slice(0, 400)
    return { n, title: r.title || '(제목 없음)', year: r.pub_date?.slice(0, 4), snippet }
  })
  const max = items.length

  let analysis
  try {
    analysis = await generateDifferentiation(
      {
        debrief: {
          title: debrief.title_guess ?? '',
          tech_summary: debrief.tech_summary ?? '',
          problem: debrief.problem ?? '',
          differentiators: debrief.differentiators ?? '',
        },
        items,
      },
      (u) => recordUsage(supabase, { projectId, operation: 'analyze' }, u),
    )
  } catch (e) {
    if (e instanceof MissingKeyError) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY_MISSING', message: 'Anthropic API 키가 설정되지 않았습니다.' },
        { status: 400 },
      )
    }
    console.error('analyze failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'analyze_failed' }, { status: 500 })
  }

  // ── Build grounding-validated rows (pure; no DB writes yet) ────────────────
  const usedIds = new Set<string>()
  const overlapRows: {
    project_id: string
    element: string
    ref_id: string | null
    relation: string
    note: string | null
  }[] = []
  for (const el of analysis.elements ?? []) {
    const valid = (el.refs ?? []).filter((r) => isAllowedRef(r.ref_n, max))
    if (valid.length === 0) {
      // keep the element visible even with no cited refs
      const relation = el.overall === 'known' ? 'discloses' : el.overall === 'partial' ? 'partial' : 'novel'
      overlapRows.push({ project_id: projectId, element: el.element, ref_id: null, relation, note: null })
    } else {
      for (const r of valid) {
        const ref_id = idByN.get(r.ref_n)!
        usedIds.add(ref_id)
        overlapRows.push({ project_id: projectId, element: el.element, ref_id, relation: r.relation, note: r.note })
      }
    }
  }

  const diffRows = (analysis.differentiation_points ?? []).map((d) => {
    const ns = allowedRefNumbers(d.supporting_ref_ns, max)
    const ids = ns.map((n) => idByN.get(n)!).filter(Boolean)
    ids.forEach((id) => usedIds.add(id))
    return { project_id: projectId, point: d.point, supporting_ref_ids: ids }
  })

  const devRows = (analysis.develop_suggestions ?? []).map((s) => ({
    project_id: projectId,
    suggestion: s.suggestion,
    kind: s.kind,
    rationale: s.rationale,
  }))

  // ── Persist: replace prior analysis, then write the audit row only after every
  //    insert succeeds (so the audit trail can never claim a write that failed). ─
  try {
    const dels = await Promise.all([
      supabase.from('overlap_matrix').delete().eq('project_id', projectId),
      supabase.from('differentiation_points').delete().eq('project_id', projectId),
      supabase.from('develop_suggestions').delete().eq('project_id', projectId),
    ])
    dels.forEach((d, i) => must(d, `analyze delete ${i}`))

    if (overlapRows.length) must(await supabase.from('overlap_matrix').insert(overlapRows), 'overlap insert')
    if (diffRows.length) must(await supabase.from('differentiation_points').insert(diffRows), 'diff insert')
    if (devRows.length) must(await supabase.from('develop_suggestions').insert(devRows), 'dev insert')

    must(
      await supabase.from('claim_strategy').upsert(
        {
          project_id: projectId,
          independent_scope: analysis.claim_strategy?.independent_scope ?? '',
          dependent_ladder: analysis.claim_strategy?.dependent_ladder ?? [],
        },
        { onConflict: 'project_id' },
      ),
      'claim_strategy upsert',
    )

    must(
      await supabase.from('change_log').insert({
        project_id: projectId,
        actor: 'ai',
        action: 'analyze_differentiation',
        ref_ids: Array.from(usedIds),
      }),
      'change_log insert',
    )
  } catch (e) {
    if (e instanceof PersistError) {
      return NextResponse.json({ error: 'persist_failed' }, { status: 500 })
    }
    console.error('analyze persist failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'persist_failed' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    elements: overlapRows.length,
    differentiation_points: diffRows.length,
    develop_suggestions: devRows.length,
  })
}
