import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchPriorArt } from '@/lib/retrieval'
import { summarizeForeignRef } from '@/lib/llm/summarize'
import type { SearchConcepts } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 60

// Cost cap: Korean summaries cost LLM tokens, so only the top foreign refs get one.
const MAX_KO_SUMMARIES = 5

// Fast pass (R6): persist the disclosure answer + clarifying answers, then run a
// single synchronous multi-source query (PubMed + OpenAlex, free) → rank → store.
export async function POST(req: Request) {
  let body: {
    projectId?: string
    disclosed?: boolean
    disclosureDate?: string | null
    answers?: Record<string, string>
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { projectId, disclosed, disclosureDate, answers } = body
  if (!projectId) return NextResponse.json({ error: 'projectId가 필요합니다.' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Persist disclosure answer (drives the §30 clock).
  if (typeof disclosed === 'boolean') {
    await supabase.from('disclosure_check').upsert(
      { project_id: projectId, disclosed, disclosure_date: disclosureDate || null },
      { onConflict: 'project_id' },
    )
  }

  // Persist clarifying answers.
  if (answers && typeof answers === 'object') {
    for (const [id, answer] of Object.entries(answers)) {
      if (answer) {
        await supabase
          .from('clarifying_qa')
          .update({ answer: String(answer) })
          .eq('id', id)
          .eq('project_id', projectId)
      }
    }
  }

  // Load the search terms produced by the debrief.
  const { data: debrief } = await supabase
    .from('debrief')
    .select('tech_summary, search_query_en, search_concepts')
    .eq('project_id', projectId)
    .single()
  if (!debrief?.search_query_en) {
    return NextResponse.json(
      { error: 'no_debrief', message: '먼저 아이디어 디브리프를 완료하세요.' },
      { status: 400 },
    )
  }

  await supabase.from('projects').update({ status: 'researching' }).eq('id', projectId)

  const { refs, coverage } = await searchPriorArt({
    query: debrief.search_query_en,
    concepts: (debrief.search_concepts as SearchConcepts) ?? { ko: [], en: [] },
  })

  // Idempotent re-run: clear previous refs/coverage for this project.
  await supabase.from('prior_art_refs').delete().eq('project_id', projectId)
  await supabase.from('coverage_report').delete().eq('project_id', projectId)

  // Korean summaries for the top foreign refs (capped; skipped gracefully w/o key).
  const koMap = new Map<string, string>()
  const topForeign = refs.filter((r) => (r.lang ?? 'en') !== 'ko').slice(0, MAX_KO_SUMMARIES)
  for (const r of topForeign) {
    const ko = await summarizeForeignRef({
      inventionSummary: debrief.tech_summary ?? '',
      refTitle: r.title ?? '',
      refAbstract: r.abstract ?? '',
    })
    if (ko) koMap.set(r.ext_id, `${ko.summary_ko}\n\n[관련성] ${ko.relevance_ko}`)
  }

  if (refs.length) {
    await supabase.from('prior_art_refs').insert(
      refs.map((r) => ({
        project_id: projectId,
        source: r.source,
        ext_id: r.ext_id,
        url: r.url,
        pub_date: r.pub_date || null,
        lang: r.lang,
        title: r.title,
        abstract: r.abstract,
        ko_summary: koMap.get(r.ext_id) ?? null,
        similarity: r.score ?? null,
      })),
    )
  }

  await supabase.from('coverage_report').insert({
    project_id: projectId,
    sources_searched: coverage.sources_searched,
    date_ranges: coverage.date_ranges,
    screened_count: coverage.screened_count,
    blind_spots: coverage.blind_spots,
  })

  await supabase.from('projects').update({ status: 'report_ready' }).eq('id', projectId)

  return NextResponse.json({ ok: true, count: refs.length })
}
