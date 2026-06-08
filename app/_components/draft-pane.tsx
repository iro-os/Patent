'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { KIPO_SECTIONS } from '@/lib/kipo/sections'
import { computeGrace } from '@/lib/kipo/disclosure'

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

// Right pane (Claude-Code's plan slot): the 출원서 draft, rendered like a document/PDF.
// Not auto-generated — the user presses "초안 작성/갱신", which runs the differentiation
// analysis over the conversation + prior art. Full 명세서/청구항 prose lands in Phase 2.
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
      {/* toolbar */}
      <div className="flex items-center justify-between gap-2 border-b border-neutral-200 bg-white/70 px-4 py-2.5 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/50">
        <span className="text-xs font-medium text-neutral-500">출원서 초안</span>
        <button
          onClick={buildDraft}
          disabled={working || !hasRefs}
          title={hasRefs ? '' : '먼저 심층 리서치를 실행하세요'}
          className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-neutral-900"
        >
          {working ? '작성 중…' : analyzed ? '초안 갱신' : '초안 작성'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {error && <p className="mb-3 text-xs text-red-500">{error}</p>}
        {!hasRefs && (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
            출원서 초안은 대화 + 선행기술을 토대로 작성됩니다. 먼저 가운데 채팅에서 “심층 리서치”를
            실행하세요.
          </p>
        )}

        {/* PDF-like document page — min-height gives it real "page" presence and the
            parent scrolls it naturally as content grows (Phase 2 full draft). */}
        <article className="mx-auto min-h-[72vh] max-w-[640px] rounded-sm bg-white px-8 py-12 text-neutral-900 shadow-lg ring-1 ring-black/5 dark:bg-neutral-100">
          <header className="border-b border-neutral-300 pb-3 text-center">
            <p className="text-[11px] tracking-widest text-neutral-400">특허출원 명세서 (초안)</p>
            <h1 className="mt-1 text-base font-bold">{project.title}</h1>
          </header>

          {grace?.grace_deadline && (
            <p
              className={`mt-3 text-center text-[11px] ${grace.expired ? 'text-red-600' : 'text-amber-700'}`}
            >
              §30 공지예외 마감 {grace.grace_deadline}
              {grace.expired ? ' (도과 가능성 — 변리사 확인)' : ` (${grace.days_remaining}일 남음)`}
            </p>
          )}

          {analyzed ? (
            <div className="mt-5 space-y-5 text-[13px] leading-relaxed">
              {claimStrategy?.independent_scope && (
                <Block heading="【청구범위 전략】">
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
                <Block heading="【발명의 효과 — 차별점】">
                  <ul className="list-disc space-y-0.5 pl-5">
                    {differentiation!.map((d, i) => (
                      <li key={i}>{d.point}</li>
                    ))}
                  </ul>
                </Block>
              )}

              {(develop?.length ?? 0) > 0 && (
                <Block heading="【보강 제안 (진보성)】">
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

          {/* 명세서 구조 (Phase 2 본문 생성) */}
          <div className="mt-7 border-t border-dashed border-neutral-300 pt-4">
            <p className="text-[10px] uppercase tracking-wide text-neutral-400">
              명세서 구조 (별지 제15호) · 본문 자동 생성은 Phase 2
            </p>
            <ol className="mt-2 space-y-0.5 text-[12px] text-neutral-500">
              {KIPO_SECTIONS.map((s) => (
                <li key={s.key} className="flex items-baseline justify-between gap-2">
                  <span>
                    【{s.key}】{s.optional ? ' (선택)' : ''}
                  </span>
                  <span className="shrink-0 text-[10px] text-neutral-300">Phase 2</span>
                </li>
              ))}
            </ol>
          </div>
        </article>
      </div>
    </div>
  )
}

function Block({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-semibold">{heading}</h2>
      <div className="mt-1">{children}</div>
    </section>
  )
}
