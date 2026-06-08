import type { ReactNode } from 'react'

// The two content panes that sit to the right of the persistent sidebar:
//   middle = chat / welcome (fills remaining width)
//   right  = 출원서 draft (fixed-width document column on large screens)
// Rendered by each page so the sidebar (in the layout) is never part of the swap.
export function Panes({ middle, right }: { middle: ReactNode; right: ReactNode }) {
  return (
    <>
      <main className="min-w-0 flex-1 overflow-y-auto">{middle}</main>
      <aside className="hidden w-[440px] shrink-0 overflow-hidden border-l border-neutral-200 lg:block dark:border-neutral-800">
        {right}
      </aside>
    </>
  )
}
