'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { SPEC_OUTLINE, SPEC_BODY_KEYS } from '@/lib/kipo/sections'
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
interface RefRow {
  id: string
  source: string
  url: string | null
  pub_date: string | null
  title: string | null
  ko_summary: string | null
}
interface SpecSectionRow {
  schema_key: string
  generated_text: string | null
  base_generated_text: string | null
  locked: boolean
}

const KIND_LABEL: Record<string, string> = {
  experiment: '실험',
  data: '데이터',
  design: '설계',
}

type SecStatus = 'empty' | 'draft' | 'done'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

// In-range [N] markers in a generated section → the unique cited numbers (for 근거 chips).
function citedNumbers(text: string | null, max: number): number[] {
  if (!text) return []
  const set = new Set<number>()
  for (const m of text.matchAll(/\[(\d{1,3})\]/g)) {
    const n = parseInt(m[1], 10)
    if (n >= 1 && n <= max) set.add(n)
  }
  return [...set].sort((a, b) => a - b)
}

// Right pane (Claude-Code's plan slot): the 출원서 draft.
//  · 목차 탭 — KIPO 구조를 그룹/접기로, 섹션별 작성 상태(3색 점)와 함께
//  · 제안서 원문 탭 — 생성된 명세서 본문(근거 칩 + 되돌리기) 또는 분석 dossier(생성 전)
// 본문은 "본문 생성"(섹션 순회, grounding 통과)으로 채우고, DOCX로 내보낸다.
export function DraftPane({
  projectId,
  project,
  refs,
  claimStrategy,
  differentiation,
  develop,
  disclosure,
  sections,
}: {
  projectId: string | null
  project: DraftProject | null
  refs?: RefRow[]
  claimStrategy?: ClaimStrategy | null
  differentiation?: DiffPoint[]
  develop?: DevRow[]
  disclosure?: Disclosure | null
  sections?: SpecSectionRow[]
}) {
  const router = useRouter()
  const [generating, setGenerating] = useState(false)
  const [genProgress, setGenProgress] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [tab, setTab] = useState<'outline' | 'document'>('outline')
  const docRef = useRef<HTMLDivElement>(null)
  const pendingScrollRef = useRef<string | null>(null)

  const goTo = (key: string) => {
    pendingScrollRef.current = key
    setTab('document')
  }
  useEffect(() => {
    if (tab !== 'document') return
    const key = pendingScrollRef.current
    if (!key) return
    pendingScrollRef.current = null
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

  const refList = refs ?? []
  const hasRefs = refList.length > 0
  const grace = disclosure?.disclosed ? computeGrace(true, disclosure.disclosure_date) : null
  const analyzed =
    !!claimStrategy?.independent_scope || (differentiation?.length ?? 0) > 0 || (develop?.length ?? 0) > 0

  const secByKey = new Map((sections ?? []).map((s) => [s.schema_key, s]))
  const hasBody = (sections ?? []).some((s) => s.generated_text)

  const statusOf = (key: string): SecStatus => {
    const s = secByKey.get(key)
    if (s?.locked) return 'done'
    if (s?.generated_text) return 'draft'
    return 'empty'
  }

  // One click: ensure the differentiation analysis exists, then generate each core
  // section in document order (per-section calls stay under maxDuration).
  const generateBody = async () => {
    setGenerating(true)
    try {
      if (!analyzed) {
        setGenProgress('차별성 분석 중…')
        const a = await fetch('/api/analyze', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ projectId }) })
        if (!a.ok) {
          const j = await a.json().catch(() => ({}))
          toast.error('차별성 분석에 실패했습니다.', { description: j.message ?? '' })
          return
        }
      }
      let allOk = true
      let done = 0
      for (let i = 0; i < SPEC_BODY_KEYS.length; i++) {
        const key = SPEC_BODY_KEYS[i]
        setGenProgress(`【${key}】 생성 중… (${i + 1}/${SPEC_BODY_KEYS.length})`)
        const r = await fetch('/api/generate', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ projectId, sectionKey: key }) })
        if (!r.ok) {
          const j = await r.json().catch(() => ({}))
          toast.error(`【${key}】 생성 실패`, { description: j.message ?? '' })
          allOk = false
          break
        }
        done++
      }
      // Only claim success if every section landed; otherwise report partial progress.
      if (allOk) toast.success('본문 생성을 완료했습니다.')
      else if (done > 0)
        toast.warning(`${done}/${SPEC_BODY_KEYS.length} 섹션까지 생성됨`, { description: '다시 “본문 생성”을 눌러 이어서 시도하세요.' })
      setTab('document')
      router.refresh() // show whatever did land
    } catch {
      toast.error('본문 생성 중 오류가 발생했습니다.')
    } finally {
      setGenerating(false)
      setGenProgress(null)
    }
  }

  // Deterministic 1-step undo — restores the saved previous text server-side (no LLM).
  const revertSection = async (key: string) => {
    try {
      const r = await fetch('/api/revert', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ projectId, sectionKey: key }) })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        toast.error('되돌리기에 실패했습니다.', { description: j.message ?? '' })
        return
      }
      toast.success(`【${key}】 직전 내용으로 되돌렸습니다.`)
      router.refresh()
    } catch {
      toast.error('되돌리기 중 오류가 발생했습니다.')
    }
  }

  const exportDocx = async () => {
    setExporting(true)
    try {
      const res = await fetch('/api/export', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ projectId }) })
      if (!res.ok) {
        toast.error('DOCX 내보내기에 실패했습니다.')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${project.title || '명세서'}.docx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('DOCX를 내보냈습니다.', { description: '변리사 검토용 초안입니다.' })
      router.refresh()
    } catch {
      toast.error('내보내기 중 오류가 발생했습니다.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-neutral-100 dark:bg-neutral-900/40">
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'outline' | 'document')} className="flex h-full flex-col">
        <div className="border-b border-neutral-200 bg-white/70 px-3 pt-2.5 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/50">
          <TabsList className="h-9 w-full justify-start gap-1 bg-transparent p-0">
            <TabsTrigger value="outline" className="rounded-md px-3 text-xs data-[state=active]:bg-neutral-200/70 dark:data-[state=active]:bg-neutral-800">
              목차
            </TabsTrigger>
            <TabsTrigger value="document" className="rounded-md px-3 text-xs data-[state=active]:bg-neutral-200/70 dark:data-[state=active]:bg-neutral-800">
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
                          <span className="truncate">{it.label ?? it.key}</span>
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
            ● 초안 있음 · ● 검토 완료 · 점 없음 = 비어 있음
          </p>
        </TabsContent>

        {/* ── 제안서 원문 ────────────────────────────────────────────────── */}
        <TabsContent value="document" className="flex-1 overflow-y-auto p-5" ref={docRef}>
          <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
            <Button onClick={generateBody} disabled={generating || !hasRefs} size="sm" title={hasRefs ? '' : '먼저 심층 리서치를 실행하세요'}>
              {generating ? genProgress ?? '생성 중…' : hasBody ? '본문 갱신' : '본문 생성'}
            </Button>
            <Button onClick={exportDocx} disabled={exporting || !hasRefs} size="sm" variant="outline" title={hasRefs ? '' : '먼저 심층 리서치를 실행하세요'}>
              {exporting ? '내보내는 중…' : 'DOCX 내보내기'}
            </Button>
          </div>

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

            {hasBody ? (
              <div className="mt-5 space-y-6 text-[13px] leading-relaxed">
                {SPEC_BODY_KEYS.map((key) => {
                  const s = secByKey.get(key)
                  if (!s?.generated_text) return null
                  return (
                    <SectionBody
                      key={key}
                      schemaKey={key}
                      text={s.generated_text}
                      canRevert={s.base_generated_text != null}
                      refs={refList}
                      onRevert={() => revertSection(key)}
                    />
                  )
                })}
                {/* 특허청구범위 — 실제 청구항 텍스트는 P1; 현재는 청구 전략을 노출 */}
                {claimStrategy?.independent_scope && (
                  <section data-sec="특허청구범위">
                    <h2 className="font-semibold">【특허청구범위】 (전략)</h2>
                    <p className="mt-1">
                      <span className="font-medium">독립항 범위.</span> {claimStrategy.independent_scope}
                    </p>
                    {claimStrategy.dependent_ladder?.length ? (
                      <ol className="mt-1.5 list-decimal space-y-0.5 pl-5">
                        {claimStrategy.dependent_ladder.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ol>
                    ) : null}
                    <p className="mt-1 text-[11px] text-neutral-400">실제 청구항 텍스트 생성은 후속 단계입니다.</p>
                  </section>
                )}
              </div>
            ) : analyzed ? (
              // Pre-body state: show the analysis dossier (strategy/effects/suggestions).
              <div className="mt-5 space-y-5 text-[13px] leading-relaxed">
                <p className="rounded-md bg-neutral-100 px-3 py-2 text-[11px] text-neutral-500">
                  분석이 준비됐습니다. 상단 <span className="font-medium">“본문 생성”</span>으로 명세서 본문을 작성하세요.
                </p>
                {claimStrategy?.independent_scope && (
                  <section>
                    <h2 className="font-semibold">【특허청구범위 전략】</h2>
                    <p className="mt-1">
                      <span className="font-medium">독립항 범위.</span> {claimStrategy.independent_scope}
                    </p>
                    {claimStrategy.dependent_ladder?.length ? (
                      <ol className="mt-1.5 list-decimal space-y-0.5 pl-5">
                        {claimStrategy.dependent_ladder.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ol>
                    ) : null}
                  </section>
                )}
                {(differentiation?.length ?? 0) > 0 && (
                  <section>
                    <h2 className="font-semibold">【발명의 효과 — 차별점】</h2>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      {differentiation!.map((d, i) => (
                        <li key={i}>{d.point}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {(develop?.length ?? 0) > 0 && (
                  <section>
                    <h2 className="font-semibold">【보강 제안 (진보성)】</h2>
                    <ul className="mt-1 space-y-1 pl-1">
                      {develop!.map((s, i) => (
                        <li key={i}>
                          <span className="mr-1 rounded bg-neutral-200 px-1 py-0.5 text-[10px] font-medium">
                            {KIND_LABEL[s.kind] ?? s.kind}
                          </span>
                          {s.suggestion}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            ) : (
              <p className="mt-6 text-center text-xs text-neutral-400">
                아직 본문이 작성되지 않았습니다.
                <br />
                {hasRefs ? '우측 상단 “본문 생성”을 누르세요.' : '대화 → 심층 리서치 → 본문 생성 순서로 진행하세요.'}
              </p>
            )}
          </article>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// One generated 명세서 section: prose + (if regenerated) a revert strip + grounding chips.
function SectionBody({
  schemaKey,
  text,
  canRevert,
  refs,
  onRevert,
}: {
  schemaKey: string
  text: string
  canRevert: boolean
  refs: RefRow[]
  onRevert: () => void
}) {
  const cited = citedNumbers(text, refs.length)
  return (
    <section data-sec={schemaKey}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">【{schemaKey}】</h2>
        {canRevert && (
          <span className="flex items-center gap-1.5 text-[11px] text-amber-600">
            ✦ AI가 수정함
            <button onClick={onRevert} className="rounded border border-amber-300 px-1.5 py-0.5 font-medium hover:bg-amber-50">
              되돌리기
            </button>
          </span>
        )}
      </div>
      <div className="mt-1 space-y-1.5">
        {text
          .split(/\n+/)
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p, i) => (
            <p key={i}>{p}</p>
          ))}
      </div>
      {cited.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-neutral-400">근거 선행기술</span>
          {cited.map((n) => {
            const r = refs[n - 1]
            if (!r) return null
            const chip = (
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">[{n}]</span>
            )
            return r.url ? (
              <a key={n} href={r.url} target="_blank" rel="noopener noreferrer" title={r.title ?? ''} className="hover:underline">
                {chip}
              </a>
            ) : (
              <span key={n} title={r.title ?? ''}>
                {chip}
              </span>
            )
          })}
        </div>
      )}
    </section>
  )
}

function StatusDot({ status }: { status: SecStatus }) {
  const cls =
    status === 'done' ? 'bg-emerald-500' : status === 'draft' ? 'bg-amber-400' : 'bg-neutral-300 dark:bg-neutral-600'
  const label = status === 'done' ? '검토 완료' : status === 'draft' ? '초안 있음' : '비어 있음'
  return <span className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${cls}`} title={label} aria-label={label} />
}
