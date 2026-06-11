'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { usePanelResize, ResizeBar } from './resizable'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export interface Invention {
  id: string
  title: string
  status: string
  pinned: boolean
  group_name: string | null
}

const STATUS_LABEL: Record<string, string> = {
  draft_intake: '입력 중',
  ready: '리서치 대기',
  researching: '리서치 중',
  report_ready: '리서치 완료',
  doc_generated: '문서 생성됨',
  refining: '편집 중',
  exported: '내보냄',
}

export function InventionSidebar({
  inventions,
  userEmail,
  navOpen = false,
  setNavOpen,
}: {
  inventions: Invention[]
  userEmail: string
  // Mobile drawer open-state, owned by AppShell (its md:hidden header has the trigger).
  // Optional so the component still renders standalone (desktop-only) without them.
  navOpen?: boolean
  setNavOpen?: (v: boolean) => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  // The sidebar lives in the shared layout and never remounts on navigation, so we
  // derive the active invention from the URL instead of receiving it as a prop.
  const activeId =
    pathname && pathname.startsWith('/projects/') ? pathname.split('/')[2] ?? null : null

  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  // Invention queued for deletion — drives the confirmation dialog (replaces window.confirm).
  const [pendingDelete, setPendingDelete] = useState<Invention | null>(null)
  // Rename / group-move share one dialog (replaces inline editing + window.prompt).
  const [editTarget, setEditTarget] = useState<{ inv: Invention; field: 'title' | 'group' } | null>(
    null,
  )
  const [editValue, setEditValue] = useState('')
  const { width: sidebarWidth, separatorProps: sidebarSep } = usePanelResize('patent.sidebarW', {
    initial: 256,
    min: 200,
    max: 420,
    side: 'left',
  })

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('patch failed')
      router.refresh()
    } catch {
      toast.error('변경에 실패했습니다.', { description: '잠시 후 다시 시도해 주세요.' })
    } finally {
      setBusy(false)
    }
  }

  // Open the confirmation dialog instead of a native window.confirm().
  const requestDelete = (inv: Invention) => setPendingDelete(inv)

  const confirmDelete = async () => {
    const inv = pendingDelete
    if (!inv) return
    setPendingDelete(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/projects/${inv.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('delete failed')
      if (inv.id === activeId) router.push('/')
      router.refresh() // sidebar persists across nav; refresh the layout to drop the row
      toast.success('발명을 삭제했습니다.', { description: inv.title })
    } catch {
      toast.error('삭제에 실패했습니다.', { description: '잠시 후 다시 시도해 주세요.' })
    } finally {
      setBusy(false)
    }
  }

  const startRename = (inv: Invention) => {
    setEditValue(inv.title)
    setEditTarget({ inv, field: 'title' })
  }
  const startGroup = (inv: Invention) => {
    setEditValue(inv.group_name ?? '')
    setEditTarget({ inv, field: 'group' })
  }
  const submitEdit = () => {
    if (!editTarget) return
    const { inv, field } = editTarget
    const v = editValue.trim()
    setEditTarget(null)
    if (field === 'title') {
      if (v && v !== inv.title) patch(inv.id, { title: v })
    } else if (v !== (inv.group_name ?? '')) {
      patch(inv.id, { group_name: v }) // empty string clears the group
    }
  }

  const newInvention = async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/projects', { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (json.id) {
        setNavOpen?.(false) // close the mobile drawer as we navigate into the new invention
        router.push(`/projects/${json.id}`)
        router.refresh() // refresh the layout so the new invention appears in this sidebar
      } else {
        toast.error('새 발명 생성에 실패했습니다.')
      }
    } catch {
      toast.error('새 발명 생성에 실패했습니다.')
    } finally {
      // The sidebar persists across navigation, so we must reset this explicitly.
      setCreating(false)
    }
  }

  // pinned first; the rest bucketed by group_name ('발명' = ungrouped).
  const pinned = inventions.filter((i) => i.pinned)
  const rest = inventions.filter((i) => !i.pinned)
  const groups = new Map<string, Invention[]>()
  for (const i of rest) {
    const k = i.group_name?.trim() || '발명'
    const arr = groups.get(k) ?? []
    arr.push(i)
    groups.set(k, arr)
  }
  // '발명' (ungrouped) rendered last, named groups first (stable insertion order).
  const groupNames = [...groups.keys()].sort((a, b) => (a === '발명' ? 1 : b === '발명' ? -1 : 0))

  const Row = (inv: Invention) => {
    const active = inv.id === activeId
    return (
      <li key={inv.id}>
        <div
          className={`group flex items-center gap-1 rounded-lg pr-1 transition ${
            active ? 'bg-neutral-200/70 dark:bg-neutral-800' : 'hover:bg-neutral-100 dark:hover:bg-neutral-900'
          }`}
        >
          <Link
            href={`/projects/${inv.id}`}
            onClick={() => setNavOpen?.(false)}
            className="flex min-w-0 flex-1 items-center justify-between px-2.5 py-2"
          >
            <span className="truncate text-sm">{inv.title}</span>
            <span className="ml-2 shrink-0 text-[10px] text-neutral-400">
              {STATUS_LABEL[inv.status] ?? inv.status}
            </span>
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="메뉴"
                className="shrink-0 rounded p-1 text-neutral-400 opacity-0 transition hover:bg-neutral-200 group-hover:opacity-100 data-[state=open]:opacity-100 dark:hover:bg-neutral-700"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <circle cx="8" cy="3" r="1.4" />
                  <circle cx="8" cy="8" r="1.4" />
                  <circle cx="8" cy="13" r="1.4" />
                </svg>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onSelect={() => startRename(inv)}>이름 변경</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => patch(inv.id, { pinned: !inv.pinned })}>
                {inv.pinned ? '핀 해제' : '핀 고정'}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => startGroup(inv)}>그룹 이동</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => requestDelete(inv)}>
                삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </li>
    )
  }

  const body = (
    <>
      <div className="flex items-center justify-between px-4 py-4">
        <Link
          href="/"
          onClick={() => setNavOpen?.(false)}
          className="text-sm font-semibold tracking-tight"
        >
          특허 AI
        </Link>
      </div>

      <div className="px-3">
        <Button onClick={newInvention} disabled={creating || busy} className="w-full">
          {creating ? '생성 중…' : '+ 새 발명'}
        </Button>
      </div>

      <nav className="mt-4 flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        {inventions.length === 0 && (
          <p className="px-2 text-xs text-neutral-400">아직 발명이 없습니다. “새 발명”으로 시작하세요.</p>
        )}

        {pinned.length > 0 && (
          <div>
            <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-400">고정됨</p>
            <ul className="space-y-0.5">{pinned.map(Row)}</ul>
          </div>
        )}

        {groupNames.map((g) => (
          <div key={g}>
            <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-400">{g}</p>
            <ul className="space-y-0.5">{groups.get(g)!.map(Row)}</ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <p className="truncate text-xs text-neutral-500">{userEmail}</p>
        <form action="/auth/signout" method="post">
          <button className="mt-1 text-xs text-neutral-400 transition hover:text-neutral-600">로그아웃</button>
        </form>
      </div>
    </>
  )

  return (
    <>
      {/* Desktop (md+): persistent, resizable sidebar that survives navigation. */}
      <aside
        style={{ width: sidebarWidth }}
        className="relative hidden h-full shrink-0 flex-col border-r border-neutral-200 bg-neutral-50/60 md:flex dark:border-neutral-800 dark:bg-neutral-950/40"
      >
        {body}
        <ResizeBar separatorProps={sidebarSep} className="absolute inset-y-0 right-0 hidden w-2 md:block" />
      </aside>

      {/* Mobile (<md): the same nav as a left drawer. The hamburger trigger lives in
          AppShell's md:hidden header, which drives navOpen. */}
      <Sheet open={navOpen} onOpenChange={(o) => setNavOpen?.(o)}>
        <SheetContent side="left" className="flex w-72 flex-col gap-0 p-0">
          <SheetTitle className="sr-only">발명 목록</SheetTitle>
          {body}
        </SheetContent>
      </Sheet>

      {/* Rename / group-move dialog (shared — radix portals out, so one instance serves
          both the desktop aside and the mobile drawer) */}
      <Dialog open={editTarget !== null} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editTarget?.field === 'title' ? '이름 변경' : '그룹 이동'}</DialogTitle>
            <DialogDescription>
              {editTarget?.field === 'title'
                ? '발명의 이름을 수정합니다.'
                : '그룹 이름을 입력하세요. 비우면 그룹에서 해제됩니다.'}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              submitEdit()
            }}
            className="grid gap-4"
          >
            <div className="grid gap-2">
              <Label htmlFor="edit-value">{editTarget?.field === 'title' ? '이름' : '그룹'}</Label>
              <Input
                id="edit-value"
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                placeholder={editTarget?.field === 'group' ? '예: 의료기기' : ''}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>
                취소
              </Button>
              <Button type="submit">저장</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>이 발명을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              “{pendingDelete?.title}”의 관련 리서치·분석 데이터까지 모두 삭제되며 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
