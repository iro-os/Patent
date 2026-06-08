import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AppShell } from '@/app/_components/app-shell'

export const dynamic = 'force-dynamic'

// Shared shell for the whole signed-in app. The sidebar lives HERE (in the layout),
// not in each page — so navigating between inventions swaps only the page content
// while the sidebar instance persists. That removes the full-screen flicker and
// keeps the sidebar's local UI state (open menus, etc.) across navigation.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: inventions } = await supabase
    .from('projects')
    .select('id, title, status, pinned, group_name')
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false })

  return (
    <AppShell inventions={inventions ?? []} userEmail={user.email ?? ''}>
      {children}
    </AppShell>
  )
}
