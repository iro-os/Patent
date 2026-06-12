'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { SPEC_OUTLINE, SPEC_BODY_KEYS, groupKipoCitations } from '@/lib/kipo/sections'
import { buildDocumentModel, paraLabel, type DocContainer, type DocSection } from '@/lib/spec/document-model'
import { computeGrace } from '@/lib/kipo/disclosure'
import { formatClaims } from '@/lib/claims/parse'
import { ReviewPane } from '@/app/_components/review-pane'
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
  ext_id?: string | null
}
interface SpecSectionRow {
  schema_key: string
  generated_text: string | null
  base_generated_text: string | null
  manual_override: string | null
  locked: boolean
}
interface ClaimRow {
  number: number
  text: string
}

const KIND_LABEL: Record<string, string> = {
  experiment: '실험',
  data: '데이터',
  design: '설계',
}

type SecStatus = 'empty' | 'draft' | 'done'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

// 본문 생성 대상: 발명의 설명 핵심 섹션(SPEC_BODY_KEYS) + 요약(별지16). 순서대로 생성한다.
const GENERATE_KEYS = [...SPEC_BODY_KEYS, '요약']

// Right pane (Claude-Code's plan slot): the 출원 서류 draft (명세서 + 요약서; 별지14 출원서 자체는 미생성).
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
  claims,
}: {
  projectId: string | null
  project: DraftProject | null
  refs?: RefRow[]
  claimStrategy?: ClaimStrategy | null
  differentiation?: DiffPoint[]
  develop?: DevRow[]
  disclosure?: Disclosure | null
  sections?: SpecSectionRow[]
  claims?: ClaimRow[]
}) {
  const router = useRouter()
  const [generating, setGenerating] = useState(false)
  const [genProgress, setGenProgress] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [tab, setTab] = useState<'outline' | 'document' | 'review'>('outline')
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
          출원 서류 초안이 여기에 표시됩니다.
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
  const claimRows = claims ?? []

  const statusOf = (key: string): SecStatus => {
    // 청구범위는 spec_sections가 아니라 claims 테이블(변리사 확정 텍스트)에 산다.
    if (key === '청구범위') return claimRows.length ? 'draft' : 'empty'
    const s = secByKey.get(key)
    if (s?.locked) return 'done'
    if (s?.generated_text) return 'draft'
    return 'empty'
  }

  // 검토 탭(컴플라이언스·뒷받침 검사)이 보는 "현재 유효 본문" — 수동 수정본이 우선.
  const effectiveText = (s: SpecSectionRow) => (s.manual_override ?? s.generated_text ?? '').trim()
  const sectionsMap = Object.fromEntries(
    (sections ?? [])
      .filter((s) => s.schema_key !== '요약' && effectiveText(s))
      .map((s) => [s.schema_key, effectiveText(s)]),
  )
  const abstractText = (() => {
    const s = secByKey.get('요약')
    return s ? effectiveText(s) || null : null
  })()

  // 섹션 검토 승인(잠금) 토글 — locked=true는 재생성·되돌리기를 서버가 거부하는 단일 스위치.
  const toggleLock = async (key: string, locked: boolean) => {
    try {
      const r = await fetch('/api/sections/lock', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ projectId, sectionKey: key, locked }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        toast.error('검토 상태 변경에 실패했습니다.', { description: j.message ?? '' })
        return
      }
      toast.success(locked ? `【${key}】 검토 완료로 잠갔습니다.` : `【${key}】 잠금을 해제했습니다.`, {
        description: locked ? 'AI 재생성·되돌리기가 차단됩니다.' : undefined,
      })
      router.refresh()
    } catch {
      toast.error('검토 상태 변경 중 오류가 발생했습니다.')
    }
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
      // 검토 완료(locked) 섹션은 건너뛴다 — 서버도 거부하지만, 중간에 409로 끊기지 않게.
      const targets = GENERATE_KEYS.filter((k) => !secByKey.get(k)?.locked)
      const skipped = GENERATE_KEYS.length - targets.length
      let allOk = true
      let done = 0
      for (let i = 0; i < targets.length; i++) {
        const key = targets[i]
        setGenProgress(`【${key}】 생성 중… (${i + 1}/${targets.length})`)
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
      if (allOk)
        toast.success('본문 생성을 완료했습니다.', {
          description: skipped > 0 ? `검토 완료(잠금) 섹션 ${skipped}개는 건너뛰었습니다.` : undefined,
        })
      else if (done > 0)
        toast.warning(`${done}/${targets.length} 섹션까지 생성됨`, { description: '다시 “본문 생성”을 눌러 이어서 시도하세요.' })
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
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'outline' | 'document' | 'review')} className="flex h-full flex-col">
        <div className="border-b border-neutral-200 bg-white/70 px-3 pt-2.5 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/50">
          <TabsList className="h-9 w-full justify-start gap-1 bg-transparent p-0">
            <TabsTrigger value="outline" className="rounded-md px-3 text-xs data-[state=active]:bg-neutral-200/70 dark:data-[state=active]:bg-neutral-800">
              목차
            </TabsTrigger>
            <TabsTrigger value="document" className="rounded-md px-3 text-xs data-[state=active]:bg-neutral-200/70 dark:data-[state=active]:bg-neutral-800">
              제안서 원문
            </TabsTrigger>
            <TabsTrigger value="review" className="rounded-md px-3 text-xs data-[state=active]:bg-neutral-200/70 dark:data-[state=active]:bg-neutral-800">
              검토
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
              출원 서류 초안은 대화 + 선행기술을 토대로 작성됩니다. 먼저 가운데 채팅에서 “심층 리서치”를
              실행하세요.
            </p>
          )}

          <article className="mx-auto min-h-[72vh] max-w-[640px] rounded-sm bg-white px-8 py-12 text-neutral-900 shadow-lg ring-1 ring-black/5 dark:bg-neutral-100">
            <header className="border-b border-neutral-300 pb-3 text-center">
              <p className="text-[11px] tracking-widest text-neutral-400">특허 출원 서류 (초안)</p>
              <h1 className="mt-1 text-base font-bold">{project.title}</h1>
            </header>

            {/* 항상 보이는 신뢰·안전 고지 — 비전문가가 'AI가 다 했다'고 오인하지 않도록(DOCX 면책과 동일 취지). */}
            <p className="mt-3 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-center text-[11px] leading-relaxed text-amber-800 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-300">
              ⚠️ 본 문서는 AI가 생성한 <strong>초안</strong>입니다. 법적 효력이 없으며, 출원 전 반드시{' '}
              <strong>변리사 검토</strong>가 필요합니다.
            </p>

            {grace?.grace_deadline && (
              <p className={`mt-3 text-center text-[11px] ${grace.expired ? 'text-red-600' : 'text-amber-700'}`}>
                §30 공지예외 마감 {grace.grace_deadline}
                {grace.expired ? ' (도과 가능성 — 변리사 확인)' : ` (${grace.days_remaining}일 남음)`}
              </p>
            )}

            {hasBody ? (
              <DocumentBody
                containers={buildDocumentModel({
                  sections: Object.fromEntries(
                    (sections ?? [])
                      .filter((s) => s.generated_text)
                      .map((s) => [
                        s.schema_key,
                        // 잠긴(검토 완료) 섹션은 되돌리기도 차단 — 서버(/api/revert)와 일관.
                        { text: s.generated_text as string, canRevert: s.base_generated_text != null && !s.locked },
                      ]),
                  ),
                  claimStrategy: claimStrategy ?? null,
                  claims: claimRows,
                  abstract: secByKey.get('요약')?.generated_text ?? null,
                  refsCount: refList.length,
                  priorArt: groupKipoCitations(refList),
                })}
                refs={refList}
                onRevert={revertSection}
                lockOf={(key) => {
                  const s = secByKey.get(key)
                  return { locked: !!s?.locked, lockable: !!s && !!effectiveText(s) }
                }}
                onToggleLock={toggleLock}
              />
            ) : analyzed ? (
              // Pre-body state: show the analysis dossier (strategy/effects/suggestions).
              <div className="mt-5 space-y-5 text-[13px] leading-relaxed">
                <p className="rounded-md bg-neutral-100 px-3 py-2 text-[11px] text-neutral-500">
                  분석이 준비됐습니다. 상단 <span className="font-medium">“본문 생성”</span>으로 명세서 본문을 작성하세요.
                </p>
                {claimStrategy?.independent_scope && (
                  <section>
                    <h2 className="font-semibold">【청구범위 전략】</h2>
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

        {/* ── 검토 (변리사 워크벤치) ─────────────────────────────────────── */}
        <TabsContent value="review" className="flex-1 overflow-y-auto">
          <ReviewPane
            projectId={projectId}
            sectionsMap={sectionsMap}
            abstract={abstractText}
            refs={refList}
            initialClaimsText={claimRows.length ? formatClaims(claimRows) : ''}
            onJump={goTo}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// 단일 문서 모델(buildDocumentModel) → 앱 본문. DOCX 내보내기와 **동일한** 계층(발명의 설명 ▸
// 발명의 내용)·연속 문단번호 【000N】·요약서를 그린다. 두 출력이 같은 모델을 walk하므로 형식이 일치.
function DocumentBody({
  containers,
  refs,
  onRevert,
  lockOf,
  onToggleLock,
}: {
  containers: DocContainer[]
  refs: RefRow[]
  onRevert: (key: string) => void
  lockOf: (key: string) => { locked: boolean; lockable: boolean }
  onToggleLock: (key: string, locked: boolean) => void
}) {
  return (
    <div className="mt-5 space-y-6 text-[13px] leading-relaxed">
      {containers.map((c) => (
        <div key={c.label} className="space-y-4">
          <h2 className="border-b border-neutral-300 pb-1 text-center text-[15px] font-bold">【{c.label}】</h2>
          {c.sections.map((s) => (
            <SectionView key={s.sectionKey} section={s} refs={refs} onRevert={onRevert} lockOf={lockOf} onToggleLock={onToggleLock} />
          ))}
        </div>
      ))}
    </div>
  )
}

// 한 섹션: (발명의 내용 같은) 하위 컨테이너 표제 + 섹션 표제(+되돌리기) + 본문/전략/노트 + 근거 칩.
function SectionView({
  section,
  refs,
  onRevert,
  lockOf,
  onToggleLock,
}: {
  section: DocSection
  refs: RefRow[]
  onRevert: (key: string) => void
  lockOf: (key: string) => { locked: boolean; lockable: boolean }
  onToggleLock: (key: string, locked: boolean) => void
}) {
  const { locked, lockable } = lockOf(section.sectionKey)
  return (
    <>
      {section.subContainerStart && (
        <h3 className="pt-1 text-[13px] font-bold text-neutral-700">【{section.subContainerStart}】</h3>
      )}
      <section data-sec={section.sectionKey} className={section.depth === 2 ? 'pl-3' : ''}>
        {section.kind !== 'claimStrategy' && (
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold">【{section.label}】</h3>
            <span className="flex items-center gap-1.5 text-[11px]">
              {section.canRevert && !locked && (
                <span className="flex items-center gap-1.5 text-amber-600">
                  ✦ AI가 수정함
                  <button
                    onClick={() => onRevert(section.sectionKey)}
                    className="rounded border border-amber-300 px-1.5 py-0.5 font-medium hover:bg-amber-50"
                  >
                    되돌리기
                  </button>
                </span>
              )}
              {/* 검토 승인 토글 — locked는 재생성·되돌리기를 서버가 차단하는 변리사 확정 표시 */}
              {locked ? (
                <span className="flex items-center gap-1.5 text-emerald-600">
                  ✓ 검토 완료
                  <button
                    onClick={() => onToggleLock(section.sectionKey, false)}
                    className="rounded border border-emerald-300 px-1.5 py-0.5 font-medium hover:bg-emerald-50"
                    title="잠금을 해제하면 AI 재생성·되돌리기가 다시 가능해집니다"
                  >
                    해제
                  </button>
                </span>
              ) : (
                lockable && (
                  <button
                    onClick={() => onToggleLock(section.sectionKey, true)}
                    className="rounded border border-neutral-300 px-1.5 py-0.5 font-medium text-neutral-500 hover:bg-neutral-100"
                    title="검토 완료로 잠그면 AI 재생성·되돌리기가 차단됩니다"
                  >
                    검토 완료
                  </button>
                )
              )}
            </span>
          </div>
        )}

        {section.kind === 'prose' && (
          <div className="mt-1 space-y-1.5">
            {section.paragraphs.map((p, i) => (
              <p key={i}>
                {p.num != null && (
                  <span className="mr-1 select-none align-top text-[11px] text-neutral-400">{paraLabel(p.num)}</span>
                )}
                {p.text}
              </p>
            ))}
          </div>
        )}

        {section.kind === 'priorArt' && (
          <div className="mt-1 space-y-1">
            {(section.priorArtItems ?? []).map((it, i) =>
              it.type === 'subhead' ? (
                <h4 key={i} className="pt-0.5 text-[12px] font-bold text-neutral-700">
                  【{it.text}】
                </h4>
              ) : (
                <p key={i} className="text-[12.5px]">
                  {it.num != null && (
                    <span className="mr-1 select-none align-top text-[11px] text-neutral-400">{paraLabel(it.num)}</span>
                  )}
                  {it.text}
                </p>
              ),
            )}
          </div>
        )}

        {section.kind === 'claims' && (
          <div className="mt-1 space-y-3">
            {(section.claimsList ?? []).map((c) => (
              <div key={c.number}>
                <h4 className="text-[12.5px] font-bold text-neutral-700">【청구항 {c.number}】</h4>
                <p className="mt-0.5 whitespace-pre-line">{c.text}</p>
              </div>
            ))}
            <p className="text-[11px] text-neutral-400">검토 탭에서 확정한 청구항입니다 — 수정도 검토 탭에서.</p>
          </div>
        )}

        {section.kind === 'claimStrategy' && section.claim && (
          <div className="mt-1">
            <p>
              <span className="font-medium">독립항 범위.</span> {section.claim.independentScope}
            </p>
            {section.claim.ladder.length > 0 && (
              <ol className="mt-1.5 list-decimal space-y-0.5 pl-5">
                {section.claim.ladder.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ol>
            )}
            <p className="mt-1 text-[11px] text-neutral-400">실제 청구항 텍스트 생성은 후속 단계입니다.</p>
          </div>
        )}

        {section.kind === 'note' && <p className="mt-1 text-neutral-500">{section.note}</p>}

        {section.refNs.length > 0 && <Chips refNs={section.refNs} refs={refs} />}
      </section>
    </>
  )
}

// 근거 선행기술 칩 — 모델의 refNs(in-range)를 refs[n-1]로 매핑.
function Chips({ refNs, refs }: { refNs: number[]; refs: RefRow[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] text-neutral-400">근거 선행기술</span>
      {refNs.map((n) => {
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
  )
}

function StatusDot({ status }: { status: SecStatus }) {
  const cls =
    status === 'done' ? 'bg-emerald-500' : status === 'draft' ? 'bg-amber-400' : 'bg-neutral-300 dark:bg-neutral-600'
  const label = status === 'done' ? '검토 완료' : status === 'draft' ? '초안 있음' : '비어 있음'
  return <span className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${cls}`} title={label} aria-label={label} />
}
