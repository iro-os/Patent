'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)

  const signInWithGoogle = async () => {
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) {
      setLoading(false)
      alert(`로그인 오류: ${error.message}`)
    }
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-bold tracking-tight">특허 AI</h1>
        <p className="mt-2 text-sm text-neutral-500">로그인하여 시작하세요.</p>
        <button
          onClick={signInWithGoogle}
          disabled={loading}
          className="mt-8 w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-medium transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          {loading ? '이동 중…' : 'Google로 계속하기'}
        </button>
        <p className="mt-6 text-xs text-neutral-400">
          각 사용자는 독립된 계정·세션을 가집니다 (RLS 격리).
        </p>
      </div>
    </main>
  )
}
