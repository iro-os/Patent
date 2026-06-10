'use client'

import type { ReactNode } from 'react'
import { usePanelResize, ResizeBar } from './resizable'

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
    </>
  )
}
