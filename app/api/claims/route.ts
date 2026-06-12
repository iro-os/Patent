import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { must, PersistError } from '@/lib/db'
import { parseClaims, formatClaims } from '@/lib/claims/parse'
import { lintClaims, checkSupport } from '@/lib/claims/lint'

export const runtime = 'nodejs'

// 변리사 검토 워크벤치 — 청구항 세트 저장. 에디터의 자유 텍스트를 서버에서 다시 파싱·린트해
// (클라이언트 린트는 UX용, 서버 린트가 저장본의 진실) claims 테이블을 프로젝트 단위로 교체하고
// 린트 결과를 consistency_flags로 함께 저장한다. change_log에 before/after 기록 — AI가 아닌
// 사람(변리사)의 확정 행위라 actor='human'.
export async function PUT(req: Request) {
  let body: { projectId?: string; claimsText?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { projectId } = body
  const claimsText = (body.claimsText ?? '').trim()
  if (!projectId) return NextResponse.json({ error: 'projectId가 필요합니다.' }, { status: 400 })
  if (claimsText.length > 50_000) {
    return NextResponse.json({ error: 'too_long', message: '청구항 텍스트가 너무 깁니다 (최대 50,000자).' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // RLS 경유 소유 확인 (0-row → 404)
  const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).single()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { claims, empty } = parseClaims(claimsText)
  if (claimsText && empty) {
    return NextResponse.json(
      { error: 'no_claims_recognized', message: '청구항 형식(【청구항 1】 …)을 인식하지 못했습니다.' },
      { status: 400 },
    )
  }
  // 헤더만 있고 본문이 빈 항은 저장을 거부한다 — 조용히 저장 후 렌더에서만 사라지면
  // DB와 문서가 어긋난 "유령 청구항"이 된다(리뷰 지적). 명시적 에러가 정직하다.
  const blank = claims.find((c) => !c.text.trim())
  if (blank) {
    return NextResponse.json(
      { error: 'empty_claim', message: `청구항 ${blank.number}의 본문이 비어 있습니다 — 내용을 쓰거나 항을 삭제하세요.` },
      { status: 400 },
    )
  }

  // 저장 린트 = 라이브 린트와 동일 룰셋(형식 §5 + 뒷받침 §42④1) — "서버 린트가 저장본의
  // 진실"이려면 클라이언트가 보여준 검사와 같은 검사를 영속화해야 한다(리뷰 지적).
  const { data: specRows } = await supabase
    .from('spec_sections')
    .select('schema_key, generated_text, manual_override')
    .eq('project_id', projectId)
  const specText = (specRows ?? [])
    .map((s) => (s.manual_override ?? s.generated_text ?? '').trim())
    .filter(Boolean)
    .join('\n')
  const issues = [...lintClaims(claims), ...checkSupport(claims, specText)]

  try {
    // change_log·복원용 직전 상태 (전체 컬럼 — insert 실패 시 best-effort 롤백 원본)
    const { data: prevRows } = await supabase
      .from('claims')
      .select('claim_type, number, parent_number, text, consistency_flags')
      .eq('project_id', projectId)
      .order('number')
    const before = prevRows?.length ? formatClaims(prevRows) : null

    // 프로젝트 단위 교체 (claims는 (project_id, number) 유니크 제약이 없어 upsert 대신 교체).
    // REST 경유라 트랜잭션이 없다 — delete 후 insert가 실패하면 기존 행을 되살려 유실을 막는다.
    must(await supabase.from('claims').delete().eq('project_id', projectId), 'claims delete')
    if (claims.length) {
      const firstNumber = Math.min(...claims.map((c) => c.number))
      const ins = await supabase.from('claims').insert(
        claims.map((c) => ({
          project_id: projectId,
          claim_type: c.cites.length ? '종속' : '독립',
          number: c.number,
          // 다중/택일 인용은 첫 항만 저장된다 — 의존 그래프의 진실은 text(인용 전체)이며,
          // parent_number는 단순 조회용 보조 컬럼이다.
          parent_number: c.cites[0] ?? null,
          text: c.text,
          // 세트 레벨 이슈(claimNumber=null — 중복 번호·결번)는 어느 행에도 안 붙으면
          // 유실되므로 첫 항 행에 함께 영속화한다(리뷰 지적).
          consistency_flags: issues.filter(
            (i) => i.claimNumber === c.number || (i.claimNumber === null && c.number === firstNumber),
          ),
        })),
      )
      if (ins.error && prevRows?.length) {
        const restore = await supabase
          .from('claims')
          .insert(prevRows.map((r) => ({ ...r, project_id: projectId })))
        if (restore.error) console.error('claims restore failed:', restore.error.message)
      }
      must(ins, 'claims insert')
    }

    must(
      await supabase.from('change_log').insert({
        project_id: projectId,
        actor: 'human',
        action: 'claims:save',
        before,
        after: claims.length ? formatClaims(claims) : null,
        ref_ids: [],
      }),
      'change_log claims save',
    )
  } catch (e) {
    if (e instanceof PersistError) return NextResponse.json({ error: 'persist_failed' }, { status: 500 })
    console.error('claims save failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'persist_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, count: claims.length, issues })
}
