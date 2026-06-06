import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

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
          <button
            disabled
            className="cursor-not-allowed rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white opacity-50 dark:bg-white dark:text-neutral-900"
          >
            + 새 발명 시작 (Phase 1)
          </button>
          <form action="/auth/signout" method="post">
            <button className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium dark:border-neutral-700">
              로그아웃
            </button>
          </form>
        </div>
      </div>

      <p className="mt-8 text-xs text-neutral-400">
        Phase 0 (foundation) 완료. 인텔리전트 기능(선행기술 리서치·문서 생성)은 Phase 1에서 추가됩니다.
      </p>
    </main>
  )
}
