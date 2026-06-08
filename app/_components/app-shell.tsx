'use client'

import type { ReactNode } from 'react'
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
  return (
    <div className="flex h-[100dvh] w-full overflow-hidden">
      <InventionSidebar inventions={inventions} userEmail={userEmail} />
      {children}
    </div>
  )
}
