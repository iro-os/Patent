import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { must, PersistError } from '@/lib/db'
import { EDITABLE_SECTION_KEYS } from '@/lib/kipo/sections'

export const runtime = 'nodejs'

const MAX_LEN = 20_000

// 인라인 직접 편집 — 제안서 원문 탭에서 한 섹션을 클릭해 손으로 고친 본문을 저장한다.
// 저장 위치는 spec_sections.manual_override(스키마가 처음부터 비워 둔 "사람의 수정본" 칸).
// generated_text(AI 원본)는 건드리지 않으므로 "AI 생성본으로" 복원이 결정론적으로 가능하다.
//  · { text }            → manual_override = text (직접 수정/작성)
//  · { restore: true }   → manual_override = null (AI 생성본으로 되돌림)
// 잠긴(검토 완료) 섹션은 거부 — locked는 재생성·되돌리기·편집을 막는 단일 스위치.
export async function POST(req: Request) {
  let body: { projectId?: string; sectionKey?: string; text?: string; restore?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { projectId, sectionKey, restore } = body
  if (!projectId || !sectionKey) {
    return NextResponse.json({ error: 'projectId와 sectionKey가 필요합니다.' }, { status: 400 })
  }
  if (!EDITABLE_SECTION_KEYS.has(sectionKey)) {
    return NextResponse.json({ error: 'not_editable', message: '이 섹션은 직접 편집 대상이 아닙니다.' }, { status: 400 })
  }
  const text = (body.text ?? '').trim()
  if (!restore) {
    if (!text) {
      return NextResponse.json(
        { error: 'empty_text', message: '내용을 입력하세요. (AI 생성본으로 되돌리려면 “AI 생성본으로”를 사용)' },
        { status: 400 },
      )
    }
    if (text.length > MAX_LEN) {
      return NextResponse.json({ error: 'too_long', message: `본문이 너무 깁니다 (최대 ${MAX_LEN.toLocaleString()}자).` }, { status: 400 })
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // RLS 경유 소유 확인.
  const { data: project } = await supabase.from('projects').select('id, status').eq('id', projectId).single()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { data: row } = await supabase
    .from('spec_sections')
    .select('generated_text, manual_override, locked, version')
    .eq('project_id', projectId)
    .eq('schema_key', sectionKey)
    .maybeSingle()

  if (row?.locked) {
    return NextResponse.json({ error: 'locked', message: '검토 완료된 섹션은 편집할 수 없습니다. 먼저 잠금을 해제하세요.' }, { status: 409 })
  }
  if (restore && !row?.generated_text) {
    return NextResponse.json({ error: 'no_ai_text', message: '복원할 AI 생성본이 없습니다.' }, { status: 400 })
  }

  const prevEffective = row ? (row.manual_override ?? row.generated_text ?? null) : null
  const nextEffective = restore ? (row?.generated_text ?? null) : text

  try {
    if (row) {
      // 동시 편집 보호: 읽은 version과 다르면 0행 갱신 → 409.
      const upd = await supabase
        .from('spec_sections')
        .update({ manual_override: restore ? null : text, version: (row.version ?? 1) + 1 })
        .eq('project_id', projectId)
        .eq('schema_key', sectionKey)
        .eq('version', row.version)
        .select('id')
      must(upd, 'spec_sections manual edit')
      if (!upd.data || upd.data.length === 0) {
        return NextResponse.json(
          { error: 'changed_since_load', message: '섹션이 변경되었습니다. 새로고침 후 다시 시도하세요.' },
          { status: 409 },
        )
      }
    } else {
      // 미생성(빈 필수) 섹션을 직접 작성 — 새 행 생성(generated_text는 비움).
      must(
        await supabase.from('spec_sections').insert({
          project_id: projectId,
          schema_key: sectionKey,
          manual_override: text,
          version: 1,
        }),
        'spec_sections manual insert',
      )
    }

    must(
      await supabase.from('change_log').insert({
        project_id: projectId,
        actor: 'human',
        action: `${restore ? 'restore_ai' : 'manual_edit'}:${sectionKey}`,
        before: prevEffective,
        after: nextEffective,
        ref_ids: [],
      }),
      'change_log manual edit',
    )

    // 본문이 생겼으니 상태 전진(exported는 강등하지 않음).
    if (project.status !== 'doc_generated' && project.status !== 'exported') {
      await supabase.from('projects').update({ status: 'doc_generated' }).eq('id', projectId)
    }
  } catch (e) {
    if (e instanceof PersistError) return NextResponse.json({ error: 'persist_failed' }, { status: 500 })
    console.error('section manual edit failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'persist_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, sectionKey, restored: !!restore, text: nextEffective })
}
