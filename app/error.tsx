'use client'

import { useEffect } from 'react'
import Link from 'next/link'

// Route error boundary. Renders a friendly Korean fallback instead of Next's raw
// error screen, and intentionally does NOT show the error detail to the client.
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold">문제가 발생했습니다</h1>
        <p className="mt-2 text-sm text-neutral-500">
          일시적인 오류일 수 있습니다. 다시 시도하거나 잠시 후 다시 방문해 주세요.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={reset}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 dark:bg-white dark:text-neutral-900"
          >
            다시 시도
          </button>
          <Link
            href="/"
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm transition hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            내 발명으로
          </Link>
        </div>
      </div>
    </main>
  )
}
