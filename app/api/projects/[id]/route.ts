import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { must, PersistError } from '@/lib/db'

export const runtime = 'nodejs'

// PATCH: rename / pin / move-to-group a project. DELETE: remove it (children cascade).
// RLS (owner-only `for all`) governs both — a non-owner request silently affects 0 rows.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { title?: string; pinned?: boolean; group_name?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const patch: Record<string, unknown> = {}
  if (typeof body.title === 'string') patch.title = body.title.trim() || '제목 없는 발명'
  if (typeof body.pinned === 'boolean') patch.pinned = body.pinned
  if ('group_name' in body) patch.group_name = body.group_name?.trim() || null
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no_fields' }, { status: 400 })
  }

  try {
    must(await supabase.from('projects').update(patch).eq('id', id), 'project patch')
  } catch (e) {
    if (e instanceof PersistError) return NextResponse.json({ error: 'persist_failed' }, { status: 500 })
    console.error('project patch failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'persist_failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    must(await supabase.from('projects').delete().eq('id', id), 'project delete')
  } catch (e) {
    if (e instanceof PersistError) return NextResponse.json({ error: 'persist_failed' }, { status: 500 })
    console.error('project delete failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'persist_failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
