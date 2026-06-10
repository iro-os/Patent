import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { regenerateSection, SectionGenError } from '@/lib/spec/section'
import { MissingKeyError } from '@/lib/llm/client'
import { PersistError } from '@/lib/db'
import { KIPO_SECTION_KEYS } from '@/lib/kipo/sections'

export const runtime = 'nodejs'
export const maxDuration = 60

// P0-A — generate (or edit) ONE KIPO 명세서 section's body prose, grounded to the
// searched prior art. Per-section (not one-shot) to stay under maxDuration; the right
// pane loops core sections, and chat edits reuse the same service with an instruction.
export async function POST(req: Request) {
  let body: { projectId?: string; sectionKey?: string; instruction?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { projectId, sectionKey } = body
  const instruction = body.instruction?.trim() || null
  if (!projectId || !sectionKey) {
    return NextResponse.json({ error: 'projectId와 sectionKey가 필요합니다.' }, { status: 400 })
  }
  if (!KIPO_SECTION_KEYS.includes(sectionKey)) {
    return NextResponse.json({ error: 'unknown_section' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: project } = await supabase.from('projects').select('id, status').eq('id', projectId).single()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  try {
    const { text, version } = await regenerateSection(supabase, projectId, sectionKey, instruction)

    // Advance status to doc_generated on first body (never downgrade past it).
    if (project.status !== 'doc_generated' && project.status !== 'exported') {
      await supabase.from('projects').update({ status: 'doc_generated' }).eq('id', projectId)
    }
    return NextResponse.json({ ok: true, sectionKey, text, version })
  } catch (e) {
    if (e instanceof SectionGenError) {
      return NextResponse.json({ error: e.code, message: e.message }, { status: e.code === 'locked' ? 409 : 400 })
    }
    if (e instanceof MissingKeyError) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY_MISSING', message: 'Anthropic API 키가 설정되지 않았습니다.' },
        { status: 400 },
      )
    }
    if (e instanceof PersistError) return NextResponse.json({ error: 'persist_failed' }, { status: 500 })
    console.error('generate section failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'generate_failed' }, { status: 500 })
  }
}
