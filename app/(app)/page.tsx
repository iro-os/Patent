import { DraftPane } from '@/app/_components/draft-pane'
import { Panes } from '@/app/_components/panes'
import { NewInventionButton } from '@/app/_components/new-invention-button'

export const dynamic = 'force-dynamic'

// Home (no invention selected). Auth + the sidebar are handled by the (app) layout;
// here we just render the welcome middle pane and an empty draft pane.
export default function Home() {
  return (
    <Panes
      middle={
        <div className="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center px-6 py-16 text-center">
          <h1 className="text-2xl font-bold tracking-tight">특허 AI</h1>
          <p className="mt-2 text-sm text-neutral-500">
            아이디어 → 전 세계 선행기술 리서치 → 등록 특허 수준의 명세서·청구항 초안.
          </p>
          <div className="mt-8">
            <NewInventionButton />
          </div>
          <p className="mt-6 text-xs text-neutral-400">또는 왼쪽 “내 발명”에서 기존 발명을 선택하세요.</p>
        </div>
      }
      right={<DraftPane projectId={null} project={null} />}
    />
  )
}
