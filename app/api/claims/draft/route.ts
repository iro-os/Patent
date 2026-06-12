import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { draftClaims } from '@/lib/llm/claims'
import { MissingKeyError } from '@/lib/llm/client'
import { recordUsage } from '@/lib/llm/usage'
import { parseClaims, formatClaims } from '@/lib/claims/parse'
import { lintClaims, checkSupport } from '@/lib/claims/lint'

export const runtime = 'nodejs'
export const maxDuration = 60

// 청구항 AI 초안 — 검토 탭의 "AI 초안 제안" 버튼. 명세서 본문(§42④1 뒷받침의 근거)과 청구
// 전략에 ground된 초안 텍스트를 돌려주되 **저장하지 않는다**: 에디터에 채워질 뿐, 확정(저장)은
// 변리사의 명시적 행위(PUT /api/claims)다. 생성 직후 결정론 린터로 재검증해 이슈를 함께 반환
// — "AI가 만든 것을 LLM이 채점"하는 순환 없이 순수 규칙으로 점검한다.
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

  const [debriefRes, claimRes, diffRes, sectionsRes] = await Promise.all([
    supabase
      .from('debrief')
      .select('title_guess, tech_summary, problem, differentiators')
      .eq('project_id', projectId)
      .maybeSingle(),
    supabase
      .from('claim_strategy')
      .select('independent_scope, dependent_ladder')
      .eq('project_id', projectId)
      .maybeSingle(),
    supabase.from('differentiation_points').select('point').eq('project_id', projectId).order('created_at'),
    supabase
      .from('spec_sections')
      .select('schema_key, generated_text, manual_override')
      .eq('project_id', projectId),
  ])

  const debrief = debriefRes.data
  if (!debrief) {
    return NextResponse.json(
      { error: 'no_debrief', message: '먼저 가운데 채팅에서 발명 내용을 알려주세요.' },
      { status: 400 },
    )
  }

  // 뒷받침 근거가 되는 본문 — 수동 수정본(manual_override)이 있으면 그것이 현재 유효 텍스트.
  const SPEC_KEYS = ['과제의 해결 수단', '발명을 실시하기 위한 구체적인 내용', '발명의 효과', '배경기술']
  const allSections = (sectionsRes.data ?? []).map((s) => ({
    key: s.schema_key,
    text: (s.manual_override ?? s.generated_text ?? '').trim(),
  }))
  const specSections = allSections.filter((s) => SPEC_KEYS.includes(s.key) && s.text)

  try {
    const drafted = await draftClaims(
      {
        debrief: {
          title: debrief.title_guess ?? '',
          tech_summary: debrief.tech_summary ?? '',
          problem: debrief.problem ?? '',
          differentiators: debrief.differentiators ?? '',
        },
        claimStrategy: claimRes.data
          ? {
              independent_scope: claimRes.data.independent_scope,
              dependent_ladder: claimRes.data.dependent_ladder ?? [],
            }
          : null,
        specSections,
        differentiation: (diffRes.data ?? []).map((d) => d.point).filter(Boolean),
      },
      (u) => recordUsage(supabase, { projectId, operation: 'draft_claims' }, u),
    )

    if (!drafted.length) {
      return NextResponse.json({ error: 'empty_draft', message: '초안 생성에 실패했습니다. 다시 시도하세요.' }, { status: 502 })
    }

    // 생성 직후 결정론 재검증 — 형식(시행령 §5) + 뒷받침(§42④1, 본문 전체 대비).
    const claimsText = formatClaims(drafted)
    const { claims } = parseClaims(claimsText)
    const specFull = allSections.map((s) => s.text).filter(Boolean).join('\n')
    const issues = [...lintClaims(claims), ...checkSupport(claims, specFull)]

    return NextResponse.json({ ok: true, claimsText, count: drafted.length, issues, basedOnBody: specSections.length > 0 })
  } catch (e) {
    if (e instanceof MissingKeyError) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY_MISSING', message: 'Anthropic API 키가 설정되지 않았습니다.' },
        { status: 400 },
      )
    }
    console.error('draft claims failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'draft_failed', message: '청구항 초안 생성 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
