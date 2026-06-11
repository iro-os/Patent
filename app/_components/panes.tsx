'use client'

import { useState, type ReactNode } from 'react'
import { FileText } from 'lucide-react'
import { usePanelResize, ResizeBar } from './resizable'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'

// The two content panes that sit to the right of the persistent sidebar:
//   middle = chat / welcome (fills remaining width)
//   right  = 출원서 draft (resizable document column on large screens)
// Rendered by each page so the sidebar (in the layout) is never part of the swap.
// 드래그 핸들로 가운데 챗 ↔ 오른쪽 초안 폭을 조절(localStorage 저장).
export function Panes({ middle, right }: { middle: ReactNode; right: ReactNode }) {
  const { width, separatorProps } = usePanelResize('patent.rightPaneW', {
    initial: 440,
    min: 340,
    max: 860,
    side: 'right',
  })
  // < lg the right draft column is hidden; expose it as a right Sheet so tablet/phone
  // users can still read & act on the 출원 서류 초안. Content mounts only when opened.
  const [draftOpen, setDraftOpen] = useState(false)
  return (
    <>
      <main className="min-w-0 flex-1 overflow-y-auto">{middle}</main>
      <ResizeBar separatorProps={separatorProps} className="hidden w-2 shrink-0 lg:block" />
      <aside
        className="hidden shrink-0 overflow-hidden border-l border-neutral-200 lg:block dark:border-neutral-800"
        style={{ width }}
      >
        {right}
      </aside>

      {/* < lg: a right-edge handle opens the draft as a drawer (kept off the bottom so it
          never overlaps the chat composer). */}
      <button
        onClick={() => setDraftOpen(true)}
        aria-label="출원 서류 초안 열기"
        className="fixed top-1/2 right-0 z-30 flex -translate-y-1/2 items-center rounded-l-lg bg-neutral-900 py-3 pr-1.5 pl-2 text-white shadow-lg lg:hidden dark:bg-white dark:text-neutral-900"
      >
        <FileText className="size-4" />
      </button>
      <Sheet open={draftOpen} onOpenChange={setDraftOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetTitle className="sr-only">출원 서류 초안</SheetTitle>
          <div className="min-h-0 flex-1 overflow-y-auto">{right}</div>
        </SheetContent>
      </Sheet>
    </>
  )
}
