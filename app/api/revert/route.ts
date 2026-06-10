import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { must, PersistError } from '@/lib/db'

export const runtime = 'nodejs'

// P0-A — deterministic 1-step undo for a generated section. Restores the saved
// previous text (spec_sections.base_generated_text) with a single DB swap. This
// NEVER calls the model: "채팅으로 원래대로 해줘"는 AI가 직전 텍스트를 근사 재생성해
// 비결정적·표류할 수 있으므로, 저장된 직전값을 그대로 복원한다(스펙 §2 Option A).
export async function POST(req: Request) {
  let body: { projectId?: string; sectionKey?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { projectId, sectionKey } = body
  if (!projectId || !sectionKey) {
    return NextResponse.json({ error: 'projectId와 sectionKey가 필요합니다.' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // RLS guarantees this row belongs to the caller; a missing row → 404.
  const { data: row } = await supabase
    .from('spec_sections')
    .select('generated_text, base_generated_text, locked, version')
    .eq('project_id', projectId)
    .eq('schema_key', sectionKey)
    .maybeSingle()

  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (row.locked) {
    return NextResponse.json({ error: 'locked', message: '잠긴 섹션은 되돌릴 수 없습니다.' }, { status: 409 })
  }
  if (row.base_generated_text == null) {
    return NextResponse.json({ error: 'nothing_to_revert', message: '되돌릴 이전 내용이 없습니다.' }, { status: 400 })
  }

  const restored = row.base_generated_text
  const current = row.generated_text ?? null

  try {
    // Compare-and-set on version: if a concurrent edit changed this section since we read
    // it, abort instead of clobbering the user's newer text (0 rows updated → 409).
    // NOTE: nulling base_generated_text consumes the 1-step undo. base_generated_text is
    // ALSO the documented 3-way-merge ANCESTOR (0001_init.sql); when the future manual-edit/
    // merge feature lands, move the undo target to a dedicated column so revert stops
    // destroying the merge ancestor.
    const upd = await supabase
      .from('spec_sections')
      .update({
        generated_text: restored,
        base_generated_text: null,
        version: (row.version ?? 1) + 1,
      })
      .eq('project_id', projectId)
      .eq('schema_key', sectionKey)
      .eq('version', row.version)
      .select('id')
    must(upd, 'spec_sections revert')
    if (!upd.data || upd.data.length === 0) {
      return NextResponse.json(
        { error: 'changed_since_load', message: '섹션이 변경되었습니다. 새로고침 후 다시 시도하세요.' },
        { status: 409 },
      )
    }

    must(
      await supabase.from('change_log').insert({
        project_id: projectId,
        actor: 'human',
        action: `revert:${sectionKey}`,
        before: current,
        after: restored,
        ref_ids: [],
      }),
      'change_log revert',
    )
  } catch (e) {
    if (e instanceof PersistError) return NextResponse.json({ error: 'persist_failed' }, { status: 500 })
    console.error('revert persist failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'persist_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, sectionKey, text: restored })
}
