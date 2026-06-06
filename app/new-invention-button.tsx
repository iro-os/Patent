'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Creates a project then navigates into its workspace (Input mode).
export function NewInventionButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const start = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/projects', { method: 'POST' })
      const json = await res.json()
      if (json.id) router.push(`/projects/${json.id}`)
      else {
        alert(`프로젝트 생성 실패: ${json.error ?? '알 수 없는 오류'}`)
        setLoading(false)
      }
    } catch (e) {
      alert(`프로젝트 생성 실패: ${String(e)}`)
      setLoading(false)
    }
  }

  return (
    <button
      onClick={start}
      disabled={loading}
      className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
    >
      {loading ? '생성 중…' : '+ 새 발명 시작'}
    </button>
  )
}
