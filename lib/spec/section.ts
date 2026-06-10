import type { SupabaseClient } from '@supabase/supabase-js'
import { generateSection, type SectionRefItem } from '@/lib/llm/generate'
import { sanitizeRefMarkers } from '@/lib/llm/grounding'
import { recordUsage } from '@/lib/llm/usage'
import { must } from '@/lib/db'
import { SECTION_GUIDANCE } from '@/lib/kipo/sections'
import { pickExemplarSection } from '@/lib/exemplars'

const MAX_REFS = 15

// Recoverable, caller-mapped failures (vs. PersistError / MissingKeyError which bubble).
export class SectionGenError extends Error {
  constructor(
    public code: 'no_debrief' | 'locked',
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'SectionGenError'
  }
}

// Single source of truth for generating/editing one 명세서 section — shared by the
// right-pane "본문 생성" button (/api/generate) and chat-driven natural-language edits
// (api/chat). Loads context, generates grounded prose, sanitizes citations to the
// closed allow-list, saves the previous text for deterministic undo (base_generated_text),
// and writes the audit row (change_log, section-tagged action). NEVER promotes status —
// callers own that.
export async function regenerateSection(
  supabase: SupabaseClient,
  projectId: string,
  sectionKey: string,
  instruction: string | null,
): Promise<{ text: string; version: number; supportingIds: string[] }> {
  const [debriefRes, refsRes, claimRes, diffRes, existingRes] = await Promise.all([
    supabase
      .from('debrief')
      .select('title_guess, tech_summary, problem, differentiators')
      .eq('project_id', projectId)
      .maybeSingle(),
    supabase
      .from('prior_art_refs')
      .select('id, title, abstract, ko_summary, pub_date, similarity')
      .eq('project_id', projectId)
      // Deterministic order (similarity is nullable/tied) so the [N] numbering here
      // matches the chip mapping in page.tsx exactly.
      .order('similarity', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .limit(MAX_REFS),
    supabase.from('claim_strategy').select('independent_scope').eq('project_id', projectId).maybeSingle(),
    supabase.from('differentiation_points').select('point').eq('project_id', projectId).order('created_at'),
    supabase
      .from('spec_sections')
      .select('generated_text, version, locked')
      .eq('project_id', projectId)
      .eq('schema_key', sectionKey)
      .maybeSingle(),
  ])

  const debrief = debriefRes.data
  if (!debrief) throw new SectionGenError('no_debrief', '먼저 아이디어 디브리프를 완료하세요.')
  if (existingRes.data?.locked) throw new SectionGenError('locked', '잠긴 섹션은 재생성할 수 없습니다.')

  const refRows = refsRes.data ?? []
  const idByN = new Map<number, string>()
  const items: SectionRefItem[] = refRows.map((r, i) => {
    const n = i + 1
    idByN.set(n, r.id)
    const snippet = (r.ko_summary || r.abstract || '').replace(/\s+/g, ' ').slice(0, 400)
    return { n, title: r.title || '(제목 없음)', year: r.pub_date?.slice(0, 4), snippet }
  })
  const max = items.length

  // Layer 2: 발명 분야에 맞는 모범 명세서의 같은 섹션을 문체 참고로 주입(매칭 없으면 null).
  // 결정론적 선택이라 한 문서의 모든 섹션이 같은 예시를 참조 → 문체 일관성 유지.
  const inventionText = `${debrief.title_guess ?? ''} ${debrief.tech_summary ?? ''} ${debrief.problem ?? ''}`
  const exemplar = pickExemplarSection(inventionText, sectionKey)

  const result = await generateSection(
    {
      sectionKey,
      guidance: SECTION_GUIDANCE[sectionKey],
      debrief: {
        title: debrief.title_guess ?? '',
        tech_summary: debrief.tech_summary ?? '',
        problem: debrief.problem ?? '',
        differentiators: debrief.differentiators ?? '',
      },
      refs: items,
      claimScope: claimRes.data?.independent_scope ?? null,
      differentiation: (diffRes.data ?? []).map((d) => d.point).filter(Boolean),
      currentText: existingRes.data?.generated_text ?? null,
      instruction,
      exemplar,
    },
    (u) => recordUsage(supabase, { projectId, operation: 'generate_section' }, u),
  )

  const { text: cleanText, cited } = sanitizeRefMarkers(result.text, max)
  const supportingIds = cited.map((n) => idByN.get(n)).filter((x): x is string => !!x)
  const prevText = existingRes.data?.generated_text ?? null
  const nextVersion = (existingRes.data?.version ?? 0) + 1

  must(
    await supabase.from('spec_sections').upsert(
      {
        project_id: projectId,
        schema_key: sectionKey,
        generated_text: cleanText,
        base_generated_text: prevText, // deterministic 1-step undo target
        version: nextVersion,
      },
      { onConflict: 'project_id,schema_key' },
    ),
    'spec_sections upsert',
  )

  must(
    await supabase.from('change_log').insert({
      project_id: projectId,
      actor: 'ai',
      action: `spec_section:${sectionKey}`,
      prompt: instruction,
      before: prevText,
      after: cleanText,
      ref_ids: supportingIds,
    }),
    'change_log insert',
  )

  return { text: cleanText, version: nextVersion, supportingIds }
}
