import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchPriorArt } from '@/lib/retrieval'
import { summarizeForeignRef } from '@/lib/llm/summarize'
import { recordUsage } from '@/lib/llm/usage'
import { must, PersistError } from '@/lib/db'
import type { SearchConcepts } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 60

// Cost cap: Korean summaries cost LLM tokens, so only the top foreign refs get one.
const MAX_KO_SUMMARIES = 5

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
// Only feed a strict YYYY-MM-DD into the Postgres `date` column; anything else → null,
// so one malformed upstream date can never reject the whole batch insert.
function toIsoDateOrNull(s?: string | null): string | null {
  return s && ISO_DATE.test(s) ? s : null
}

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

  // Fail closed if the project isn't the caller's (RLS-scoped read returns null otherwise).
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .single()
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  // Tracks whether we flipped status to 'researching', so the catch only rolls back
  // when we actually started the run (never clobbers status on a pre-run failure).
  let started = false
  try {
    // Persist disclosure answer (drives the §30 clock).
    if (typeof disclosed === 'boolean') {
      must(
        await supabase.from('disclosure_check').upsert(
          { project_id: projectId, disclosed, disclosure_date: toIsoDateOrNull(disclosureDate) },
          { onConflict: 'project_id' },
        ),
        'disclosure_check upsert',
      )
    }

    // Persist clarifying answers.
    if (answers && typeof answers === 'object') {
      for (const [id, answer] of Object.entries(answers)) {
        if (answer) {
          must(
            await supabase
              .from('clarifying_qa')
              .update({ answer: String(answer) })
              .eq('id', id)
              .eq('project_id', projectId),
            'clarifying_qa update',
          )
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

    must(
      await supabase.from('projects').update({ status: 'researching' }).eq('id', projectId),
      'status researching',
    )
    started = true

    const { refs, coverage } = await searchPriorArt({
      query: debrief.search_query_en,
      concepts: (debrief.search_concepts as SearchConcepts) ?? { ko: [], en: [] },
    })

    // Korean summaries for the top foreign refs (capped). Optional enrichment — a
    // single failed summary must NOT abort the run (it would otherwise nuke a report
    // we've already committed to rebuilding), so each call is isolated.
    const koMap = new Map<string, string>()
    const topForeign = refs.filter((r) => (r.lang ?? 'en') !== 'ko').slice(0, MAX_KO_SUMMARIES)
    for (const r of topForeign) {
      try {
        const ko = await summarizeForeignRef(
          {
            inventionSummary: debrief.tech_summary ?? '',
            refTitle: r.title ?? '',
            refAbstract: r.abstract ?? '',
          },
          (u) => recordUsage(supabase, { projectId, operation: 'summarize' }, u),
        )
        if (ko) koMap.set(r.ext_id, `${ko.summary_ko}\n\n[관련성] ${ko.relevance_ko}`)
      } catch (e) {
        console.error('ko summary failed:', r.ext_id, e instanceof Error ? e.message : e)
      }
    }

    // Assemble the new rows BEFORE the destructive delete, so a failure earlier in
    // the pipeline can never wipe the user's existing report.
    const refRows = refs.map((r) => ({
      project_id: projectId,
      source: r.source,
      ext_id: r.ext_id,
      url: r.url,
      pub_date: toIsoDateOrNull(r.pub_date),
      lang: r.lang,
      title: r.title,
      abstract: r.abstract,
      ko_summary: koMap.get(r.ext_id) ?? null,
      similarity: r.score ?? null,
    }))

    // Collapse any rows sharing (source, ext_id) so the batch insert can never
    // violate the prior_art unique index (migration 0005) and fail the whole run.
    // (The retrieval dedupe keys on title, a different axis, so guard here too.)
    const seenRefIds = new Set<string>()
    const uniqueRefRows = refRows.filter((r) => {
      const k = `${r.source}:${r.ext_id}`
      if (seenRefIds.has(k)) return false
      seenRefIds.add(k)
      return true
    })

    // Idempotent replace: delete only now that the new data is ready to write.
    must(
      await supabase.from('prior_art_refs').delete().eq('project_id', projectId),
      'prior_art delete',
    )
    must(
      await supabase.from('coverage_report').delete().eq('project_id', projectId),
      'coverage delete',
    )
    if (uniqueRefRows.length) {
      must(await supabase.from('prior_art_refs').insert(uniqueRefRows), 'prior_art insert')
    }
    must(
      await supabase.from('coverage_report').insert({
        project_id: projectId,
        sources_searched: coverage.sources_searched,
        date_ranges: coverage.date_ranges,
        screened_count: coverage.screened_count,
        blind_spots: coverage.blind_spots,
      }),
      'coverage insert',
    )

    must(
      await supabase.from('projects').update({ status: 'report_ready' }).eq('id', projectId),
      'status report_ready',
    )

    return NextResponse.json({
      ok: true,
      count: uniqueRefRows.length,
      empty: uniqueRefRows.length === 0,
    })
  } catch (e) {
    // Never strand the project in 'researching': roll back to a re-runnable state.
    if (started) {
      await supabase.from('projects').update({ status: 'ready' }).eq('id', projectId)
    }
    if (e instanceof PersistError) {
      return NextResponse.json({ error: 'persist_failed' }, { status: 500 })
    }
    console.error('research failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'research_failed' }, { status: 500 })
  }
}
