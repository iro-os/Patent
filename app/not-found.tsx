import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold">페이지를 찾을 수 없습니다</h1>
        <p className="mt-2 text-sm text-neutral-500">
          요청하신 발명을 찾을 수 없거나 접근 권한이 없습니다.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 dark:bg-white dark:text-neutral-900"
        >
          내 발명으로 돌아가기
        </Link>
      </div>
    </main>
  )
}
