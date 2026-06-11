'use client'

import { useState, type ReactNode } from 'react'
import { Menu } from 'lucide-react'
import { InventionSidebar, type Invention } from './invention-sidebar'

// Three-pane workspace shell (Claude-Code plan-mode layout). Rendered inside the
// shared (app) layout, so the sidebar survives navigation between inventions
// (no remount = no flicker). `children` is the page content (middle + right panes,
// via <Panes/>).
export function AppShell({
  inventions,
  userEmail,
  children,
}: {
  inventions: Invention[]
  userEmail: string
  children: ReactNode
}) {
  // Mobile nav drawer state. The sidebar is hidden < md, so on phones the hamburger in
  // the mobile header below is the only way into the invention list.
  const [navOpen, setNavOpen] = useState(false)
  return (
    <div className="flex h-[100dvh] w-full overflow-hidden">
      <InventionSidebar
        inventions={inventions}
        userEmail={userEmail}
        navOpen={navOpen}
        setNavOpen={setNavOpen}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header (md:hidden) — entry point to the nav on small screens. */}
        <header className="flex items-center gap-2 border-b border-neutral-200 px-2 py-2 md:hidden dark:border-neutral-800">
          <button
            onClick={() => setNavOpen(true)}
            aria-label="발명 목록 열기"
            className="rounded-lg p-2 text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
          >
            <Menu className="size-5" />
          </button>
          <span className="text-sm font-semibold tracking-tight">특허 AI</span>
        </header>
        {/* Content row: Panes renders the chat pane + (lg) right draft as flex children. */}
        <div className="flex min-h-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
