import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { NewInventionButton } from './new-invention-button'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, string> = {
  draft_intake: '입력 중',
  ready: '리서치 대기',
  researching: '리서치 중',
  report_ready: '리서치 완료',
  doc_generated: '문서 생성됨',
  refining: '편집 중',
  exported: '내보냄',
}

export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: projects } = await supabase
    .from('projects')
    .select('id, title, status, updated_at')
    .order('updated_at', { ascending: false })

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">특허 AI</h1>
      <p className="mt-2 text-neutral-500">
        아이디어 → 전 세계 선행기술 리서치 → 등록 특허 수준의 명세서·청구항 초안.
      </p>

      <div className="mt-10 rounded-xl border border-neutral-200 p-6 dark:border-neutral-800">
        <p className="text-sm text-neutral-500">로그인됨</p>
        <p className="font-medium">{user.email}</p>
        <div className="mt-6 flex gap-3">
          <NewInventionButton />
          <form action="/auth/signout" method="post">
            <button className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium dark:border-neutral-700">
              로그아웃
            </button>
          </form>
        </div>
      </div>

      {projects && projects.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-neutral-500">내 발명</h2>
          <ul className="mt-3 divide-y divide-neutral-200 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  className="flex items-center justify-between px-4 py-3 text-sm transition hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  <span className="font-medium">{p.title}</span>
                  <span className="text-xs text-neutral-400">
                    {STATUS_LABEL[p.status] ?? p.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-8 text-xs text-neutral-400">
        Phase 1 (무료 슬라이스): Input 모드 디브리프 + 무료 선행기술 검색(PubMed·OpenAlex). 특허 DB·심층 리서치·문서 생성은 다음 단계입니다.
      </p>
    </main>
  )
}
