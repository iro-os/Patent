'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import { SPEC_OUTLINE } from '@/lib/kipo/sections'
import { computeGrace } from '@/lib/kipo/disclosure'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

interface DraftProject {
  title: string
  status: string
}
interface ClaimStrategy {
  independent_scope: string | null
  dependent_ladder: string[]
}
interface DiffPoint {
  point: string
}
interface DevRow {
  suggestion: string
  kind: string
  rationale: string
}
interface Disclosure {
  disclosed: boolean
  disclosure_date: string | null
}

const KIND_LABEL: Record<string, string> = {
  experiment: '실험',
  data: '데이터',
  design: '설계',
}

type SecStatus = 'empty' | 'draft' | 'done'

// Right pane (Claude-Code's plan slot): the 출원서 draft.
//  · 목차 탭 — KIPO 명세서 구조를 그룹/접기로, 섹션별 작성 상태(3색 점)와 함께
//  · 제안서 원문 탭 — 문서/PDF 형태의 실제 초안 (Phase 2에서 본문 자동 생성)
// 초안은 자동 생성이 아니라 "초안 작성/갱신"으로 차별성 분석을 돌려 채운다.
export function DraftPane({
  projectId,
  project,
  refsCount,
  claimStrategy,
  differentiation,
  develop,
  disclosure,
}: {
  projectId: string | null
  project: DraftProject | null
  refsCount?: number
  claimStrategy?: ClaimStrategy | null
  differentiation?: DiffPoint[]
  develop?: DevRow[]
  disclosure?: Disclosure | null
}) {
  const router = useRouter()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'outline' | 'document'>('outline')
  const docRef = useRef<HTMLDivElement>(null)
  const pendingScrollRef = useRef<string | null>(null)

  // Jump from a 목차 item to its section in the 제안서 원문 tab.
  const goTo = (key: string) => {
    pendingScrollRef.current = key
    setTab('document')
  }
  useEffect(() => {
    if (tab !== 'document') return
    const key = pendingScrollRef.current
    if (!key) return
    pendingScrollRef.current = null
    // Section keys contain only Korean text + spaces (no quotes/backslashes), so they
    // embed safely in a double-quoted attribute selector without escaping.
    const el = docRef.current?.querySelector(`[data-sec="${key}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [tab])

  if (!project || !projectId) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-100 p-6 text-center dark:bg-neutral-900/40">
        <p className="text-sm leading-relaxed text-neutral-400">
          왼쪽에서 발명을 선택하면
          <br />
          출원서 초안이 여기에 표시됩니다.
        </p>
      </div>
    )
  }

  const grace = disclosure?.disclosed ? computeGrace(true, disclosure.disclosure_date) : null
  const hasRefs = (refsCount ?? 0) > 0
  const analyzed =
    !!claimStrategy?.independent_scope || (differentiation?.length ?? 0) > 0 || (develop?.length ?? 0) > 0

  // Best-effort per-section status from the data we already hold (Phase 1).
  // Full body generation (and a 검토완료/done flag) lands in Phase 2.
  const filled = new Set<string>()
  if (project.title) filled.add('발명의 명칭')
  if (hasRefs) {
    filled.add('선행기술문헌')
    filled.add('배경기술')
  }
  if (claimStrategy?.independent_scope) {
    filled.add('특허청구범위')
    filled.add('과제의 해결 수단')
  }
  if ((differentiation?.length ?? 0) > 0) filled.add('발명의 효과')
  if ((develop?.length ?? 0) > 0) filled.add('발명을 실시하기 위한 구체적인 내용')
  const statusOf = (key: string): SecStatus => (filled.has(key) ? 'draft' : 'empty')

  const buildDraft = async () => {
    setWorking(true)
    setError(null)
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.message ?? json.error ?? '초안 작성에 실패했습니다.')
        return
      }
      router.refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-neutral-100 dark:bg-neutral-900/40">
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'outline' | 'document')} className="flex h-full flex-col">
        <div className="border-b border-neutral-200 bg-white/70 px-3 pt-2.5 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/50">
          <TabsList className="h-9 w-full justify-start gap-1 bg-transparent p-0">
            <TabsTrigger
              value="outline"
              className="rounded-md px-3 text-xs data-[state=active]:bg-neutral-200/70 dark:data-[state=active]:bg-neutral-800"
            >
              목차
            </TabsTrigger>
            <TabsTrigger
              value="document"
              className="rounded-md px-3 text-xs data-[state=active]:bg-neutral-200/70 dark:data-[state=active]:bg-neutral-800"
            >
              제안서 원문
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ── 목차 ───────────────────────────────────────────────────────── */}
        <TabsContent value="outline" className="flex-1 overflow-y-auto px-2 py-3">
          {SPEC_OUTLINE.map((g) => (
            <Collapsible key={g.group} defaultOpen={!g.optional} className="mb-1">
              <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm font-bold text-neutral-700 transition hover:bg-neutral-200/50 dark:text-neutral-200 dark:hover:bg-neutral-800/50">
                <span>{g.group}</span>
                <ChevronDown className="h-4 w-4 text-neutral-400 transition-transform group-data-[state=closed]:-rotate-90" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="pb-1">
                  {g.items.map((it) => {
                    const st = statusOf(it.key)
                    return (
                      <li key={it.key}>
                        <button
                          onClick={() => goTo(it.key)}
                          className="flex w-full items-center gap-2 rounded-md py-1.5 pl-4 pr-2 text-left text-sm text-neutral-600 transition hover:bg-neutral-200/50 dark:text-neutral-400 dark:hover:bg-neutral-800/50"
                        >
                          <span className="truncate">{it.key}</span>
                          {st !== 'empty' && <StatusDot status={st} />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          ))}
          <p className="mt-3 px-2 text-[10px] leading-relaxed text-neutral-400">
            ● 초안 있음 · ● 검토 완료 · 점 없음 = 비어 있음. 본문 자동 생성은 Phase 2.
          </p>
        </TabsContent>

        {/* ── 제안서 원문 ────────────────────────────────────────────────── */}
        <TabsContent value="document" className="flex-1 overflow-y-auto p-5" ref={docRef}>
          <div className="mb-3 flex items-center justify-end">
            <Button onClick={buildDraft} disabled={working || !hasRefs} size="sm" title={hasRefs ? '' : '먼저 심층 리서치를 실행하세요'}>
              {working ? '작성 중…' : analyzed ? '초안 갱신' : '초안 작성'}
            </Button>
          </div>

          {error && <p className="mb-3 text-xs text-red-500">{error}</p>}
          {!hasRefs && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
              출원서 초안은 대화 + 선행기술을 토대로 작성됩니다. 먼저 가운데 채팅에서 “심층 리서치”를
              실행하세요.
            </p>
          )}

          <article className="mx-auto min-h-[72vh] max-w-[640px] rounded-sm bg-white px-8 py-12 text-neutral-900 shadow-lg ring-1 ring-black/5 dark:bg-neutral-100">
            <header className="border-b border-neutral-300 pb-3 text-center">
              <p className="text-[11px] tracking-widest text-neutral-400">특허출원 명세서 (초안)</p>
              <h1 className="mt-1 text-base font-bold">{project.title}</h1>
            </header>

            {grace?.grace_deadline && (
              <p className={`mt-3 text-center text-[11px] ${grace.expired ? 'text-red-600' : 'text-amber-700'}`}>
                §30 공지예외 마감 {grace.grace_deadline}
                {grace.expired ? ' (도과 가능성 — 변리사 확인)' : ` (${grace.days_remaining}일 남음)`}
              </p>
            )}

            {analyzed ? (
              <div className="mt-5 space-y-5 text-[13px] leading-relaxed">
                {claimStrategy?.independent_scope && (
                  <Block heading="【특허청구범위 전략】" sec="특허청구범위">
                    <p>
                      <span className="font-medium">독립항 범위.</span> {claimStrategy.independent_scope}
                    </p>
                    {claimStrategy.dependent_ladder?.length ? (
                      <ol className="mt-1.5 list-decimal space-y-0.5 pl-5">
                        {claimStrategy.dependent_ladder.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ol>
                    ) : null}
                  </Block>
                )}

                {(differentiation?.length ?? 0) > 0 && (
                  <Block heading="【발명의 효과 — 차별점】" sec="발명의 효과">
                    <ul className="list-disc space-y-0.5 pl-5">
                      {differentiation!.map((d, i) => (
                        <li key={i}>{d.point}</li>
                      ))}
                    </ul>
                  </Block>
                )}

                {(develop?.length ?? 0) > 0 && (
                  <Block heading="【보강 제안 (진보성)】" sec="발명을 실시하기 위한 구체적인 내용">
                    <ul className="space-y-1 pl-1">
                      {develop!.map((s, i) => (
                        <li key={i}>
                          <span className="mr-1 rounded bg-neutral-200 px-1 py-0.5 text-[10px] font-medium">
                            {KIND_LABEL[s.kind] ?? s.kind}
                          </span>
                          {s.suggestion}
                        </li>
                      ))}
                    </ul>
                  </Block>
                )}
              </div>
            ) : (
              <p className="mt-6 text-center text-xs text-neutral-400">
                아직 초안이 작성되지 않았습니다.
                <br />
                {hasRefs ? '우측 상단 “초안 작성”을 누르세요.' : '대화 → 심층 리서치 → 초안 작성 순서로 진행하세요.'}
              </p>
            )}
          </article>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function StatusDot({ status }: { status: SecStatus }) {
  const cls =
    status === 'done' ? 'bg-emerald-500' : status === 'draft' ? 'bg-amber-400' : 'bg-neutral-300 dark:bg-neutral-600'
  const label = status === 'done' ? '검토 완료' : status === 'draft' ? '초안 있음' : '비어 있음'
  return <span className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${cls}`} title={label} aria-label={label} />
}

function Block({ heading, sec, children }: { heading: string; sec?: string; children: React.ReactNode }) {
  return (
    <section data-sec={sec}>
      <h2 className="font-semibold">{heading}</h2>
      <div className="mt-1">{children}</div>
    </section>
  )
}
