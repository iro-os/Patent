import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { IntakeView } from './intake'
import { ReportView } from './report'

export const dynamic = 'force-dynamic'

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // RLS: a user can only read their own project (returns null otherwise).
  const { data: project } = await supabase.from('projects').select('*').eq('id', id).single()
  if (!project) notFound()

  const [debriefRes, clarifyingRes, disclosureRes, refsRes, coverageRes] = await Promise.all([
    supabase.from('debrief').select('*').eq('project_id', id).maybeSingle(),
    supabase
      .from('clarifying_qa')
      .select('id, question, options, answer')
      .eq('project_id', id)
      .order('created_at'),
    supabase.from('disclosure_check').select('*').eq('project_id', id).maybeSingle(),
    supabase
      .from('prior_art_refs')
      .select('*')
      .eq('project_id', id)
      .order('similarity', { ascending: false, nullsFirst: false }),
    supabase.from('coverage_report').select('*').eq('project_id', id).maybeSingle(),
  ])

  const refs = refsRes.data ?? []
  // Show the report once research has run (even with 0 hits, so the coverage panel
  // + "다시 검색" stay visible) — keyed on status, not just on having refs.
  const researchedStatuses = ['report_ready', 'doc_generated', 'refining', 'exported']
  const showReport = researchedStatuses.includes(project.status) || refs.length > 0

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-neutral-400 transition hover:text-neutral-600">
          ← 내 발명
        </Link>
        <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-500 dark:bg-neutral-800">
          {project.status}
        </span>
      </div>

      <h1 className="mt-4 text-2xl font-bold tracking-tight">{project.title}</h1>

      <div className="mt-8">
        {showReport ? (
          <ReportView refs={refs} coverage={coverageRes.data} disclosure={disclosureRes.data} />
        ) : (
          <IntakeView
            projectId={id}
            initialDebrief={debriefRes.data}
            initialClarifying={clarifyingRes.data ?? []}
            initialDisclosure={disclosureRes.data}
          />
        )}
      </div>

      <footer className="mt-16 border-t border-neutral-200 pt-6 text-xs leading-relaxed text-neutral-400 dark:border-neutral-800">
        본 도구는 법률 자문을 제공하지 않으며, 생성된 초안은 변리사의 검토를 거쳐야 합니다. AI는
        발명자가 될 수 없습니다. 선행기술 검색 결과는 완전성을 보장하지 않습니다.
      </footer>
    </main>
  )
}
