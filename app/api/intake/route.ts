import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateDebrief } from '@/lib/llm/debrief'
import { MissingKeyError } from '@/lib/llm/client'

export const runtime = 'nodejs'
export const maxDuration = 60

// Input mode (§14.1): store the raw idea, run the Sonnet debrief, persist the
// structured understanding + clarifying questions + worldwide search terms.
export async function POST(req: Request) {
  let body: { projectId?: string; ideaText?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { projectId, ideaText } = body
  if (!projectId || !ideaText?.trim()) {
    return NextResponse.json({ error: 'projectId와 발명 설명이 필요합니다.' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // RLS scopes this to the user's own project.
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .single()
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  // Persist the raw intake (audit + future re-debrief).
  await supabase
    .from('intake_inputs')
    .insert({ project_id: projectId, kind: 'text', content: ideaText })

  let debrief
  try {
    debrief = await generateDebrief(ideaText)
  } catch (e) {
    if (e instanceof MissingKeyError) {
      return NextResponse.json(
        {
          error: 'ANTHROPIC_API_KEY_MISSING',
          message:
            'Anthropic API 키가 설정되지 않았습니다. patent-app/.env.local 에 ANTHROPIC_API_KEY 를 넣고 서버를 재시작하세요.',
        },
        { status: 400 },
      )
    }
    console.error('debrief failed:', e)
    return NextResponse.json({ error: 'debrief_failed', message: String(e) }, { status: 500 })
  }

  // Upsert the debrief (one row per project; unique constraint from migration 0002).
  await supabase.from('debrief').upsert(
    {
      project_id: projectId,
      title_guess: debrief.title_guess,
      tech_summary: debrief.tech_summary,
      problem: debrief.problem,
      differentiators: debrief.differentiators,
      ipc_candidates: debrief.ipc_candidates,
      missing_items: debrief.missing_items,
      search_query_en: debrief.search_query_en,
      search_concepts: debrief.search_concepts,
    },
    { onConflict: 'project_id' },
  )

  // Replace clarifying questions for this project.
  await supabase.from('clarifying_qa').delete().eq('project_id', projectId)
  if (debrief.clarifying_questions.length) {
    await supabase.from('clarifying_qa').insert(
      debrief.clarifying_questions.map((q) => ({
        project_id: projectId,
        question: q.question,
        options: q.options,
      })),
    )
  }

  await supabase
    .from('projects')
    .update({ title: debrief.title_guess || '제목 없는 발명', status: 'ready' })
    .eq('id', projectId)

  const { data: clarifying } = await supabase
    .from('clarifying_qa')
    .select('id, question, options, answer')
    .eq('project_id', projectId)
    .order('created_at')

  return NextResponse.json({ debrief, clarifying: clarifying ?? [] })
}
