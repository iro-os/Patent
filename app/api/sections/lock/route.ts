import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { must, PersistError } from '@/lib/db'

export const runtime = 'nodejs'

// 섹션 검토 승인(잠금) 토글 — 변리사 검토 워크플로의 핵심 한 칸. locked=true인 섹션은
// 재생성(regenerateSection)·되돌리기(/api/revert)가 이미 서버에서 거부되므로, 이 토글은
// "이 섹션은 검토 완료 — AI가 더 이상 건드리지 말 것"의 단일 스위치가 된다(AGENTS.md
// invariant #3: respect locked). 목차 탭의 상태 점도 locked → 초록(검토 완료)으로 바뀐다.
export async function POST(req: Request) {
  let body: { projectId?: string; sectionKey?: string; locked?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { projectId, sectionKey } = body
  if (!projectId || !sectionKey || typeof body.locked !== 'boolean') {
    return NextResponse.json({ error: 'projectId, sectionKey, locked(boolean)가 필요합니다.' }, { status: 400 })
  }
  const locked = body.locked

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // RLS 경유 — 본문이 있는 섹션만 잠글 수 있다 (빈 섹션 잠금은 무의미).
  const { data: row } = await supabase
    .from('spec_sections')
    .select('id, generated_text, manual_override, locked')
    .eq('project_id', projectId)
    .eq('schema_key', sectionKey)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'not_found', message: '해당 섹션이 없습니다.' }, { status: 404 })
  if (locked && !(row.generated_text ?? row.manual_override)) {
    return NextResponse.json({ error: 'empty_section', message: '본문이 없는 섹션은 잠글 수 없습니다.' }, { status: 400 })
  }
  if (row.locked === locked) return NextResponse.json({ ok: true, sectionKey, locked }) // 멱등

  try {
    must(
      await supabase
        .from('spec_sections')
        .update({ locked })
        .eq('project_id', projectId)
        .eq('schema_key', sectionKey),
      'spec_sections lock',
    )
    must(
      await supabase.from('change_log').insert({
        project_id: projectId,
        actor: 'human',
        action: `${locked ? 'lock' : 'unlock'}:${sectionKey}`,
        ref_ids: [],
      }),
      'change_log lock',
    )
  } catch (e) {
    if (e instanceof PersistError) return NextResponse.json({ error: 'persist_failed' }, { status: 500 })
    console.error('section lock failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'persist_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, sectionKey, locked })
}
