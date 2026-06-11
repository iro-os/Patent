'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

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
        toast.error(`프로젝트 생성 실패: ${json.error ?? '알 수 없는 오류'}`)
        setLoading(false)
      }
    } catch (e) {
      console.error('project create failed:', e)
      toast.error('프로젝트 생성에 실패했습니다. 네트워크를 확인하고 다시 시도해 주세요.')
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
