'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Markdown } from '@/app/_components/markdown'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface Msg {
  id: string
  role: 'user' | 'assistant'
  kind: string // text | research | analysis
  content: string
  data: Record<string, unknown>
  created_at: string
}

export interface RefRow {
  id: string
  source: string
  url: string | null
  pub_date: string | null
  lang: string | null
  title: string | null
  ko_summary: string | null
  abstract: string | null
  similarity: number | null
}

interface Coverage {
  sources_searched: { source: string; queries: number }[]
  date_ranges: Record<string, string>
  screened_count: number
  blind_spots: string[]
}

const SOURCE_LABEL: Record<string, string> = {
  pubmed: 'PubMed',
  openalex: 'OpenAlex',
  google_patents: 'Google Patents',
  kipris: 'KIPRIS',
  epo: 'EPO',
}

// Rotating status lines so a long wait feels alive instead of frozen.
const CHAT_STATUS = [
  '발명 내용을 분석하고 있어요…',
  '명세서 관점에서 채울 수 있는 항목을 정리 중…',
  '빠진 부분과 보강 포인트를 찾는 중…',
  '거의 다 됐어요…',
]
const RESEARCH_STATUS = [
  '전 세계 선행기술을 검색 중… (PubMed · OpenAlex)',
  '관련 문헌을 추려내는 중…',
  '핵심 내용을 한국어로 요약하는 중…',
  '정리하고 있어요…',
]

// Onboarding seeds for the empty state — concrete, medical-device-flavoured (client: 엑셀바이오)
// so a non-expert sees the *level of detail* a strong first message carries (문제 → 기존 방식 →
// 차별점). Clicking one fills the composer; the user then edits it into their own invention.
const INVENTION_EXAMPLES: { label: string; text: string }[] = [
  {
    label: '약물 방출 스텐트',
    text: '혈관에 삽입하는 스텐트인데, 재협착을 막기 위해 표면 코팅에서 약물이 약 4주에 걸쳐 서서히 방출되도록 설계했습니다. 기존 제품은 초기에 약물이 한꺼번에 빠져나가는 문제가 있었는데, 이를 다층 코팅으로 해결했습니다.',
  },
  {
    label: '심전도 측정 패치',
    text: '가슴에 붙이는 일회용 심전도 패치입니다. 측정 데이터를 무선으로 스마트폰에 전송하고, 부정맥이 감지되면 자동으로 알림을 보냅니다. 방수 처리되어 샤워 중에도 떼지 않고 연속 측정할 수 있는 점이 핵심입니다.',
  },
  {
    label: '내시경 지혈 클립',
    text: '내시경 수술에서 출혈 부위를 집는 지혈 클립입니다. 한 손으로 조작할 수 있고, 기존 제품보다 적은 힘으로도 조직을 단단히 고정합니다. 시술 시간을 단축하고 재출혈을 줄이는 것이 목표입니다.',
  },
]

export function Workspace({
  projectId,
  messages: serverMessages,
  refs,
  coverage,
  disclosure,
  usage,
}: {
  projectId: string
  messages: Msg[]
  refs: RefRow[]
  coverage: Coverage | null
  disclosure: { disclosed: boolean; disclosure_date: string | null } | null
  usage: { cost: number; calls: number } | null
}) {
  const router = useRouter()

  // Local render state, seeded from the server. Lets us append a chat turn optimistically
  // (instant feedback) without waiting for router.refresh(). We re-seed whenever the
  // server's message set actually changes (a research/analysis turn, or a refresh/poll
  // bringing a persisted turn).
  const [msgs, setMsgs] = useState<Msg[]>(serverMessages)
  const serverSig = useMemo(() => serverMessages.map((m) => m.id).join(','), [serverMessages])
  const seededRef = useRef(serverSig)
  useEffect(() => {
    if (seededRef.current !== serverSig) {
      seededRef.current = serverSig
      setMsgs(serverMessages)
    }
  }, [serverSig, serverMessages])

  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [researching, setResearching] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [showDisc, setShowDisc] = useState(false)
  const [disclosed, setDisclosed] = useState<boolean | null>(disclosure ? disclosure.disclosed : null)
  const [discDate, setDiscDate] = useState(disclosure?.disclosure_date ?? '')

  // Navigation resilience: if the session's last persisted turn is an unanswered user
  // message, the assistant is being generated server-side (the route persists the user
  // message before calling the model). Poll until the reply lands, so leaving and
  // returning to a session mid-generation still shows the answer.
  const lastServer = serverMessages[serverMessages.length - 1]
  const pendingId = lastServer && lastServer.role === 'user' ? lastServer.id : null
  // Derived (not stored) so the effect body holds no synchronous setState. The timeout
  // is keyed to the pending message id, so a new pending turn is never stale.
  const [timedOutFor, setTimedOutFor] = useState<string | null>(null)
  const pollTimedOut = pendingId !== null && timedOutFor === pendingId
  const pollPending = pendingId !== null && !pollTimedOut
  useEffect(() => {
    if (!pendingId || timedOutFor === pendingId) return
    let tries = 0
    const iv = setInterval(() => {
      tries++
      if (tries >= 35) {
        clearInterval(iv)
        setTimedOutFor(pendingId) // give up after ~2 min (set inside a timer callback — safe)
        return
      }
      router.refresh()
    }, 3500)
    return () => clearInterval(iv)
  }, [pendingId, timedOutFor, router])

  const busy = sending || researching || pollPending
  // Welcome/dropzone only when nothing is happening yet.
  const empty = msgs.length === 0 && !busy

  // Scroll: jump instantly to the bottom on mount (no "scroll through everything"
  // animation when opening a session); smooth-scroll only for subsequent updates.
  const scrollRef = useRef<HTMLDivElement>(null)
  const didInitialScroll = useRef(false)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: didInitialScroll.current ? 'smooth' : 'auto' })
    didInitialScroll.current = true
  }, [msgs.length, busy])

  const addFiles = (list: FileList | null) => {
    if (list) setFiles((prev) => [...prev, ...Array.from(list)])
  }

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    const withFiles =
      files.length > 0
        ? `${text}\n\n[첨부: ${files.map((f) => f.name).join(', ')} — 파싱은 Phase 2]`
        : text

    // Optimistic user bubble (instant). The temp id is replaced by the persisted row
    // when the server state re-seeds.
    const tempId = `tmp-${Date.now()}`
    const optimistic: Msg = {
      id: tempId,
      role: 'user',
      kind: 'text',
      content: withFiles,
      data: {},
      created_at: new Date().toISOString(),
    }
    setSending(true)
    setInput('')
    setFiles([])
    setMsgs((prev) => [...prev, optimistic])

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, message: withFiles }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // The user message is persisted server-side; keep the bubble and toast the error.
        // We deliberately do NOT refresh here, so the failed turn doesn't trip the
        // pending-poll. The user can simply send again.
        toast.error(json.message ?? json.error ?? '응답 생성에 실패했습니다. 다시 시도해 주세요.')
        return
      }
      if (json.message) {
        const reply = { ...(json.message as Msg), data: (json.message as Msg).data ?? {} }
        setMsgs((prev) => [...prev, reply])
      }
      router.refresh() // sync sidebar title + right-pane debrief; reconcile ids
    } catch {
      toast.error('네트워크 오류로 전송에 실패했습니다. 다시 시도해 주세요.')
    } finally {
      setSending(false)
    }
  }

  const runResearch = async () => {
    setShowDisc(false)
    setResearching(true)
    try {
      const res = await fetch('/api/research/fast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          disclosed: disclosed ?? false,
          disclosureDate: disclosed ? discDate || null : null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.message ?? json.error ?? '선행기술 검색에 실패했습니다.')
        return
      }
      router.refresh()
    } catch {
      toast.error('네트워크 오류로 검색에 실패했습니다.')
    } finally {
      setResearching(false)
    }
  }

  const lastResearchId = [...msgs].reverse().find((m) => m.kind === 'research')?.id ?? null
  // Nudge toward the natural next step: once the idea has at least one AI reply but no
  // prior-art search has run yet, promote the 심층 리서치 action (primary styling + hint).
  const hasResearch = lastResearchId !== null
  const suggestResearch =
    !researching && !hasResearch && msgs.some((m) => m.role === 'assistant' && m.kind === 'text')

  return (
    <div className="flex h-full flex-col">
      {/* ── Chat timeline ─────────────────────────────────────────────────── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-6">
          {empty ? (
            <EmptyState
              dragOver={dragOver}
              setDragOver={setDragOver}
              addFiles={addFiles}
              onPickExample={setInput}
            />
          ) : (
            <div className="space-y-5">
              {msgs.map((m) => (
                <MessageTurn
                  key={m.id}
                  m={m}
                  refs={m.id === lastResearchId ? refs : []}
                  coverage={m.id === lastResearchId ? coverage : null}
                />
              ))}
              {busy && <ThinkingIndicator mode={researching ? 'research' : 'chat'} />}
              {pollTimedOut && !busy && (
                <p className="text-sm text-amber-600">
                  응답이 지연되고 있어요. 메시지를 다시 보내보세요.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Composer ──────────────────────────────────────────────────────── */}
      <div className="border-t border-neutral-200 bg-white/70 px-6 py-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/60">
        <div className="mx-auto max-w-2xl">
          {files.length > 0 && (
            <div className="mb-2">
              <div className="flex flex-wrap gap-1.5">
                {files.map((f, i) => (
                  <span
                    key={`${f.name}-${i}`}
                    className="flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-xs dark:bg-neutral-800"
                  >
                    {f.name}
                    <button
                      onClick={() => setFiles(files.filter((_, j) => j !== i))}
                      className="text-neutral-400 hover:text-neutral-600"
                      aria-label="첨부 제거"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-500">
                ℹ️ 파일 내용 자동 분석은 준비 중이에요. 지금은 파일명만 첨부되니, 핵심 내용은 메시지에 함께 적어 주세요.
              </p>
            </div>
          )}

          {suggestResearch && (
            <div className="mb-2 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-1.5 text-xs text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
              <span>💡</span>
              <span>
                발명이 어느 정도 정리됐어요. 이제 <strong>🔍 심층 리서치</strong>로 선행기술을 확인해 보세요.
              </span>
            </div>
          )}

          <div className="rounded-2xl border border-neutral-300 p-2 transition focus-within:border-neutral-500 dark:border-neutral-700">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              aria-label="발명 아이디어 입력"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              rows={2}
              placeholder={
                msgs.length === 0
                  ? '발명 아이디어를 설명해 주세요 — 핵심 기술·해결 문제·기존 방식과의 차이 (Enter 전송 · Shift+Enter 줄바꿈)'
                  : '이어서 답하거나 추가 설명을 입력하세요…'
              }
              className="max-h-48 w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed outline-none"
            />
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-1.5">
                <label className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'cursor-pointer')}>
                  <input type="file" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
                  + 첨부
                </label>
                <Popover open={showDisc} onOpenChange={setShowDisc}>
                  <PopoverTrigger asChild>
                    <Button
                      variant={suggestResearch ? 'default' : 'outline'}
                      size="sm"
                      disabled={researching}
                    >
                      {researching ? '검색 중…' : '🔍 심층 리서치'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" side="top" className="w-72">
                    <DisclosureForm
                      disclosed={disclosed}
                      setDisclosed={setDisclosed}
                      discDate={discDate}
                      setDiscDate={setDiscDate}
                      onRun={runResearch}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <Button onClick={send} disabled={sending || !input.trim()} size="sm">
                전송
              </Button>
            </div>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-3 px-1 text-[11px] text-neutral-400">
            <span>AI 초안은 변리사 검토가 필요합니다. 선행기술 검색은 완전성을 보장하지 않습니다.</span>
            {usage && (
              <span className="shrink-0">
                AI 실측 ${usage.cost.toFixed(4)} · {usage.calls}회
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Pulsing avatar + rotating status line so long waits feel alive.
function ThinkingIndicator({ mode }: { mode: 'chat' | 'research' }) {
  const lines = mode === 'research' ? RESEARCH_STATUS : CHAT_STATUS
  const [i, setI] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => setI((x) => (x + 1) % lines.length), 3500)
    return () => clearInterval(iv)
  }, [lines.length])
  return (
    <div className="flex items-center gap-3" role="status" aria-live="polite">
      <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[10px] font-semibold text-white dark:bg-white dark:text-neutral-900">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neutral-900/30 dark:bg-white/30" />
        AI
      </span>
      <span className="animate-pulse text-sm text-neutral-500">{lines[i]}</span>
    </div>
  )
}

function EmptyState({
  dragOver,
  setDragOver,
  addFiles,
  onPickExample,
}: {
  dragOver: boolean
  setDragOver: (v: boolean) => void
  addFiles: (l: FileList | null) => void
  onPickExample: (text: string) => void
}) {
  return (
    <div className="py-10 text-center">
      <h2 className="text-lg font-semibold">새 발명</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-neutral-500">
        아이디어를 자유롭게 설명하면 AI가 정리하고 빠진 점을 물어봅니다. 대화를 이어가며 발명을
        구체화한 뒤, 심층 리서치와 출원 서류 초안으로 넘어가세요.
      </p>

      <div className="mx-auto mt-5 max-w-md text-left">
        <p className="text-xs text-neutral-400">예시로 시작해 보세요 — 누르면 입력창에 채워져요</p>
        <div className="mt-2 flex flex-col gap-1.5">
          {INVENTION_EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              onClick={() => onPickExample(ex.text)}
              className="rounded-lg border border-neutral-200 px-3 py-2 text-left transition hover:border-neutral-400 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              <span className="block text-xs font-medium text-neutral-800 dark:text-neutral-100">
                {ex.label}
              </span>
              <span className="mt-0.5 line-clamp-2 block text-[11px] text-neutral-400">{ex.text}</span>
            </button>
          ))}
        </div>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          addFiles(e.dataTransfer.files)
        }}
        className={`mt-6 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition ${
          dragOver ? 'border-neutral-500 bg-neutral-50 dark:bg-neutral-900' : 'border-neutral-300 dark:border-neutral-700'
        }`}
      >
        <input type="file" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
        <p className="text-sm">
          자료를 끌어다 놓거나 <span className="underline">내 컴퓨터에서 선택</span>
        </p>
        <p className="mt-1 text-[11px] text-neutral-400">
          PDF·HWP·DOCX·이미지 — 자동 파싱은 Phase 2에서 지원됩니다.
        </p>
      </label>
      <p className="mt-6 text-xs text-neutral-400">↓ 아래 입력창에 첫 메시지를 보내 시작하세요.</p>
    </div>
  )
}

function MessageTurn({ m, refs, coverage }: { m: Msg; refs: RefRow[]; coverage: Coverage | null }) {
  if (m.role === 'user') return <UserBubble text={m.content} />

  if (m.kind === 'research') {
    return <ResearchTurn content={m.content} data={m.data} refs={refs} coverage={coverage} />
  }

  if (m.kind === 'analysis') {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
        {m.content}
      </div>
    )
  }

  // assistant text
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[10px] font-semibold text-white dark:bg-white dark:text-neutral-900">
        AI
      </div>
      <div className="min-w-0 flex-1">
        <Markdown text={m.content} />
      </div>
    </div>
  )
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-neutral-900 px-3.5 py-2 text-sm text-white dark:bg-white dark:text-neutral-900">
        {text}
      </div>
    </div>
  )
}

function ResearchTurn({
  content,
  data,
  refs,
  coverage,
}: {
  content: string
  data: Record<string, unknown>
  refs: RefRow[]
  coverage: Coverage | null
}) {
  const count = typeof data.count === 'number' ? data.count : refs.length
  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800">
          심층 리서치
        </span>
        <span className="text-sm font-medium">선행기술 {count}건</span>
      </div>
      <p className="mt-1 text-xs text-neutral-500">{content}</p>

      {coverage && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <Stat label="소스" value={`${coverage.sources_searched?.length ?? 0}개`} />
          <Stat label="스크리닝" value={`${coverage.screened_count}`} />
          <Stat label="PubMed" value={coverage.date_ranges?.pubmed ?? 'N/A'} />
          <Stat label="OpenAlex" value={coverage.date_ranges?.openalex ?? 'N/A'} />
        </div>
      )}

      {coverage?.blind_spots && coverage.blind_spots.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-amber-600">알려진 한계 (완전성 미보장)</summary>
          <ul className="mt-1 list-inside list-disc text-xs text-neutral-500">
            {coverage.blind_spots.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </details>
      )}

      {refs.length > 0 && (
        <ul className="mt-3 space-y-2">
          {refs.map((r) => (
            <li key={r.id} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
              <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                  {SOURCE_LABEL[r.source] ?? r.source}
                </span>
                {r.pub_date && <span>{r.pub_date.slice(0, 4)}</span>}
                {typeof r.similarity === 'number' && (
                  <span className="ml-auto">관련도 {Math.round(r.similarity * 100)}%</span>
                )}
              </div>
              <h4 className="mt-1 text-sm font-medium">
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {r.title || '(제목 없음)'} ↗
                  </a>
                ) : (
                  (r.title ?? '(제목 없음)')
                )}
              </h4>
              {r.ko_summary && (
                <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-neutral-50 p-2.5 text-xs leading-relaxed text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
                  {r.ko_summary}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Disclosure form rendered inside a shadcn Popover (Popover handles the backdrop,
// positioning, outside-click and focus — so this is just the form body now).
function DisclosureForm({
  disclosed,
  setDisclosed,
  discDate,
  setDiscDate,
  onRun,
}: {
  disclosed: boolean | null
  setDisclosed: (v: boolean) => void
  discDate: string
  setDiscDate: (v: string) => void
  onRun: () => void
}) {
  return (
    <div className="text-left">
      <p className="text-xs font-medium">출원 전 공개(논문·발표·판매)가 있었나요? (§30)</p>
      <div className="mt-2 flex gap-2">
        <Button
          variant={disclosed === false ? 'default' : 'outline'}
          size="sm"
          onClick={() => setDisclosed(false)}
        >
          아니오
        </Button>
        <Button
          variant={disclosed === true ? 'default' : 'outline'}
          size="sm"
          onClick={() => setDisclosed(true)}
        >
          예
        </Button>
      </div>
      {disclosed && (
        <div className="mt-3 grid gap-1.5">
          <label className="text-[11px] text-neutral-500">최초 공개일</label>
          <Input
            type="date"
            value={discDate}
            onChange={(e) => setDiscDate(e.target.value)}
            className="h-8"
          />
        </div>
      )}
      <Button onClick={onRun} size="sm" className="mt-3 w-full">
        선행기술 검색 시작 (무료)
      </Button>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-neutral-400">{label}</p>
      <p className="mt-0.5 font-medium text-neutral-700 dark:text-neutral-200">{value}</p>
    </div>
  )
}
