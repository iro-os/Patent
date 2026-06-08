'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Markdown } from '@/app/_components/markdown'

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

  // The server is the source of truth, but we render from LOCAL state so a chat turn
  // can be appended OPTIMISTICALLY — the user's message and the AI reply show instantly,
  // with no dependence on router.refresh() landing first. (That coupling was the bug:
  // the first message left the EmptyState on screen and the reply only appeared if the
  // refresh happened to repaint.) When the server's message set actually changes — a
  // research/analysis turn is persisted, or router.refresh() brings the saved turn — we
  // re-seed from the server below.
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
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [showDisc, setShowDisc] = useState(false)
  const [disclosed, setDisclosed] = useState<boolean | null>(disclosure ? disclosure.disclosed : null)
  const [discDate, setDiscDate] = useState(disclosure?.disclosure_date ?? '')

  const scrollRef = useRef<HTMLDivElement>(null)
  // Show the welcome/dropzone only when there is genuinely nothing happening yet.
  const empty = msgs.length === 0 && !sending && !researching

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs.length, sending, researching])

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

    // Optimistic user bubble — instant feedback (the temp id is replaced when the
    // server's persisted turn re-seeds via the effect above).
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
    setError(null)
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
        setError(json.message ?? json.error ?? '응답 생성에 실패했습니다.')
        setInput(text) // restore so the user doesn't lose their message
        setMsgs((prev) => prev.filter((m) => m.id !== tempId)) // roll back the optimistic bubble
        return
      }
      // Append the AI reply immediately from the response (no refresh needed for chat).
      if (json.message) {
        const reply = { ...(json.message as Msg), data: (json.message as Msg).data ?? {} }
        setMsgs((prev) => [...prev, reply])
      }
      // Sync the sidebar title + right-pane debrief in the background. This does NOT
      // gate the conversation appearing.
      router.refresh()
    } catch (e) {
      setError(String(e))
      setInput(text)
      setMsgs((prev) => prev.filter((m) => m.id !== tempId))
    } finally {
      setSending(false)
    }
  }

  const runResearch = async () => {
    setShowDisc(false)
    setResearching(true)
    setError(null)
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
        setError(json.message ?? json.error ?? '선행기술 검색에 실패했습니다.')
        return
      }
      // The research turn is persisted server-side; refresh re-seeds msgs (effect above).
      router.refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setResearching(false)
    }
  }

  const lastResearchId = [...msgs].reverse().find((m) => m.kind === 'research')?.id ?? null

  return (
    <div className="flex h-full flex-col">
      {/* ── Chat timeline ─────────────────────────────────────────────────── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-6">
          {empty ? (
            <EmptyState dragOver={dragOver} setDragOver={setDragOver} addFiles={addFiles} />
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
              {(sending || researching) && (
                <p className="text-sm text-neutral-400">
                  {researching ? '선행기술 검색 중… (PubMed · OpenAlex)' : 'AI가 생각 중…'}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Composer ──────────────────────────────────────────────────────── */}
      <div className="border-t border-neutral-200 bg-white/70 px-6 py-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/60">
        <div className="mx-auto max-w-2xl">
          {error && <p className="mb-2 text-sm text-red-500">{error}</p>}

          {files.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
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
          )}

          <div className="rounded-2xl border border-neutral-300 p-2 transition focus-within:border-neutral-500 dark:border-neutral-700">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
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
                <label className="cursor-pointer rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-500 transition hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900">
                  <input type="file" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
                  + 첨부
                </label>
                <div className="relative">
                  <button
                    onClick={() => setShowDisc((v) => !v)}
                    disabled={researching}
                    className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                  >
                    {researching ? '검색 중…' : '🔍 심층 리서치'}
                  </button>
                  {showDisc && (
                    <DisclosurePopover
                      disclosed={disclosed}
                      setDisclosed={setDisclosed}
                      discDate={discDate}
                      setDiscDate={setDiscDate}
                      onRun={runResearch}
                      onClose={() => setShowDisc(false)}
                    />
                  )}
                </div>
              </div>
              <button
                onClick={send}
                disabled={sending || !input.trim()}
                className="rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-neutral-900"
              >
                전송
              </button>
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

function EmptyState({
  dragOver,
  setDragOver,
  addFiles,
}: {
  dragOver: boolean
  setDragOver: (v: boolean) => void
  addFiles: (l: FileList | null) => void
}) {
  return (
    <div className="py-10 text-center">
      <h2 className="text-lg font-semibold">새 발명</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-neutral-500">
        아이디어를 자유롭게 설명하면 AI가 정리하고 빠진 점을 물어봅니다. 대화를 이어가며 발명을
        구체화한 뒤, 심층 리서치와 출원서 초안으로 넘어가세요.
      </p>
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

function DisclosurePopover({
  disclosed,
  setDisclosed,
  discDate,
  setDiscDate,
  onRun,
  onClose,
}: {
  disclosed: boolean | null
  setDisclosed: (v: boolean) => void
  discDate: string
  setDiscDate: (v: string) => void
  onRun: () => void
  onClose: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute bottom-10 left-0 z-20 w-72 rounded-xl border border-neutral-200 bg-white p-3 text-left shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
        <p className="text-xs font-medium">출원 전 공개(논문·발표·판매)가 있었나요? (§30)</p>
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => setDisclosed(false)}
            className={`rounded-full border px-2.5 py-1 text-xs ${disclosed === false ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900' : 'border-neutral-300 dark:border-neutral-700'}`}
          >
            아니오
          </button>
          <button
            onClick={() => setDisclosed(true)}
            className={`rounded-full border px-2.5 py-1 text-xs ${disclosed === true ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900' : 'border-neutral-300 dark:border-neutral-700'}`}
          >
            예
          </button>
        </div>
        {disclosed && (
          <div className="mt-2">
            <label className="text-[11px] text-neutral-500">최초 공개일</label>
            <input
              type="date"
              value={discDate}
              onChange={(e) => setDiscDate(e.target.value)}
              className="ml-2 rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-xs dark:border-neutral-700"
            />
          </div>
        )}
        <button
          onClick={onRun}
          className="mt-3 w-full rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 dark:bg-white dark:text-neutral-900"
        >
          선행기술 검색 시작 (무료)
        </button>
      </div>
    </>
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
