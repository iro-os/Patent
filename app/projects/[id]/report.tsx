'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { computeGrace } from '@/lib/kipo/disclosure'

interface RefRow {
  id: string
  source: string
  ext_id: string
  url: string | null
  pub_date: string | null
  lang: string | null
  title: string | null
  abstract: string | null
  ko_summary: string | null
  similarity: number | null
}

interface CoverageRow {
  sources_searched: { source: string; queries: number }[]
  date_ranges: Record<string, string>
  screened_count: number
  blind_spots: string[]
}

interface DisclosureRow {
  disclosed: boolean
  disclosure_date: string | null
}

interface OverlapRow {
  element: string
  ref_id: string | null
  relation: string // discloses | partial | novel
  note: string | null
}

interface DiffRow {
  point: string
  supporting_ref_ids: string[]
}

interface DevRow {
  suggestion: string
  kind: string // experiment | data | design
  rationale: string
}

interface ClaimStrategyRow {
  independent_scope: string | null
  dependent_ladder: string[]
}

interface UsageSummary {
  cost: number
  input: number
  output: number
  cacheRead: number
  calls: number
}

const SOURCE_LABEL: Record<string, string> = {
  pubmed: 'PubMed',
  openalex: 'OpenAlex',
  google_patents: 'Google Patents',
  kipris: 'KIPRIS',
  epo: 'EPO',
}

const KIND_LABEL: Record<string, string> = {
  experiment: '실험 제안',
  data: '데이터 제안',
  design: '설계 제안',
}

export function ReportView({
  projectId,
  refs,
  coverage,
  disclosure,
  overlap,
  differentiation,
  develop,
  claimStrategy,
  usage,
}: {
  projectId: string
  refs: RefRow[]
  coverage: CoverageRow | null
  disclosure: DisclosureRow | null
  overlap: OverlapRow[]
  differentiation: DiffRow[]
  develop: DevRow[]
  claimStrategy: ClaimStrategyRow | null
  usage: UsageSummary | null
}) {
  const router = useRouter()
  const [rerunning, setRerunning] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const grace = disclosure?.disclosed ? computeGrace(true, disclosure.disclosure_date) : null
  const refTitle = new Map(refs.map((r) => [r.id, r.title || '(제목 없음)']))
  const analyzed = overlap.length > 0 || differentiation.length > 0 || develop.length > 0

  // group overlap rows by element
  const byElement = new Map<string, OverlapRow[]>()
  for (const row of overlap) {
    const list = byElement.get(row.element) ?? []
    list.push(row)
    byElement.set(row.element, list)
  }

  const rerun = async () => {
    setRerunning(true)
    setError(null)
    try {
      const res = await fetch('/api/research/fast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          disclosed: disclosure?.disclosed ?? false,
          disclosureDate: disclosure?.disclosure_date ?? null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.message ?? json.error ?? '재검색에 실패했습니다.')
        return
      }
      router.refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setRerunning(false)
    }
  }

  const analyze = async () => {
    setAnalyzing(true)
    setError(null)
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.message ?? json.error ?? '분석에 실패했습니다.')
        return
      }
      router.refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="space-y-8">
      {grace?.grace_deadline && (
        <div
          className={`rounded-lg border p-3 text-xs ${
            grace.expired
              ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
              : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
          }`}
        >
          §30 유예기간 마감: <strong>{grace.grace_deadline}</strong>{' '}
          {grace.expired
            ? `— 이미 ${Math.abs(grace.days_remaining ?? 0)}일 경과 (유예기간 도과 가능성, 변리사 확인 필요)`
            : `— ${grace.days_remaining}일 남음`}
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      {/* Coverage panel — honesty first (never claims 100%) */}
      {coverage && (
        <section className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-500">검색 커버리지</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <Stat label="검색 소스" value={`${coverage.sources_searched?.length ?? 0}개`} />
            <Stat label="스크리닝 건수" value={`${coverage.screened_count}`} />
            <Stat label="PubMed 연도" value={coverage.date_ranges?.pubmed ?? 'N/A'} />
            <Stat label="OpenAlex 연도" value={coverage.date_ranges?.openalex ?? 'N/A'} />
          </div>
          {coverage.blind_spots?.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-amber-600">알려진 한계 (완전성 미보장)</p>
              <ul className="mt-1 list-inside list-disc text-xs text-neutral-500">
                {coverage.blind_spots.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {usage && (
        <p className="text-xs text-neutral-400">
          AI 사용(실측):{' '}
          <strong className="text-neutral-600 dark:text-neutral-300">${usage.cost.toFixed(4)}</strong> ·
          입력 {fmtK(usage.input)} · 출력 {fmtK(usage.output)} · 캐시읽기 {fmtK(usage.cacheRead)} · 호출{' '}
          {usage.calls}회
        </p>
      )}

      {/* ── 차별성 분석 / 디벨롭 (Surface A) ──────────────────────────────── */}
      {!analyzed ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-5 text-center dark:border-neutral-700">
          <p className="text-sm text-neutral-500">
            선행기술을 바탕으로 차별성 분석(중복/신규 매트릭스) · 청구 전략 · 디벨롭 제안을 생성합니다.
          </p>
          <button
            onClick={analyze}
            disabled={analyzing}
            className="mt-4 rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60 dark:bg-white dark:text-neutral-900"
          >
            {analyzing ? '분석 중… (구성요소 × 선행기술)' : '차별성·디벨롭 분석 실행'}
          </button>
        </div>
      ) : (
        <>
          {/* 차별성 분석 */}
          <section>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-500">차별성 분석 (구성요소별)</h2>
              <button
                onClick={analyze}
                disabled={analyzing}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
              >
                {analyzing ? '분석 중…' : '다시 분석'}
              </button>
            </div>
            <div className="mt-3 space-y-3">
              {[...byElement.entries()].map(([element, rows]) => {
                const overall = rows.some((r) => r.relation === 'discloses')
                  ? 'known'
                  : rows.some((r) => r.relation === 'partial')
                    ? 'partial'
                    : 'novel'
                const cited = rows.filter((r) => r.ref_id)
                return (
                  <div
                    key={element}
                    className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium">{element}</p>
                      <RelationBadge overall={overall} />
                    </div>
                    {cited.length > 0 && (
                      <ul className="mt-2 space-y-1.5 text-xs text-neutral-500">
                        {cited.map((r, i) => (
                          <li key={i}>
                            <span
                              className={
                                r.relation === 'discloses' ? 'text-red-500' : 'text-amber-500'
                              }
                            >
                              {r.relation === 'discloses' ? '개시' : '부분 개시'}
                            </span>{' '}
                            · {refTitle.get(r.ref_id!) ?? '(참조)'}
                            {r.note ? ` — ${r.note}` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          {/* 차별점 (white-space) */}
          {differentiation.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-neutral-500">차별점 (권리화 유리)</h2>
              <ul className="mt-3 space-y-2">
                {differentiation.map((d, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/30"
                  >
                    <p className="text-emerald-800 dark:text-emerald-300">{d.point}</p>
                    {d.supporting_ref_ids?.length > 0 && (
                      <p className="mt-1 text-xs text-neutral-500">
                        근거: {d.supporting_ref_ids.map((id) => refTitle.get(id) ?? '참조').join(' · ')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 청구 전략 */}
          {claimStrategy && (
            <section className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
              <h2 className="text-sm font-semibold text-neutral-500">
                청구 전략 (전략은 여기, 청구항 문안은 문서 단계)
              </h2>
              {claimStrategy.independent_scope && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-neutral-400">독립항 권리범위</p>
                  <p className="mt-0.5 text-sm">{claimStrategy.independent_scope}</p>
                </div>
              )}
              {claimStrategy.dependent_ladder?.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-neutral-400">종속항 사다리 (넓음 → 좁음)</p>
                  <ol className="mt-1 list-inside list-decimal text-sm text-neutral-700 dark:text-neutral-200">
                    {claimStrategy.dependent_ladder.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ol>
                </div>
              )}
            </section>
          )}

          {/* 디벨롭 제안 */}
          {develop.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-neutral-500">디벨롭 제안 (진보성 강화)</h2>
              <div className="mt-3 space-y-2">
                {develop.map((s, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800"
                  >
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                        {KIND_LABEL[s.kind] ?? s.kind}
                      </span>
                      <span>{s.suggestion}</span>
                    </div>
                    {s.rationale && (
                      <p className="mt-1 text-xs text-neutral-500">{s.rationale}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* ── 선행기술 원본 목록 ────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-500">
            선행기술 {refs.length}건 (관련도순)
          </h2>
          <div className="flex gap-2">
            <button
              onClick={rerun}
              disabled={rerunning}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              {rerunning ? '재검색 중…' : '다시 검색'}
            </button>
            <button
              disabled
              title="특허 DB + 심층 에이전트 루프는 예산 확정 후 추가됩니다"
              className="cursor-not-allowed rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-400 dark:border-neutral-800"
            >
              더 깊이 파기 (예산 확정 후)
            </button>
          </div>
        </div>

        <ul className="mt-4 space-y-3">
          {refs.map((r) => (
            <li key={r.id} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <div className="flex items-center gap-2 text-xs text-neutral-400">
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                  {SOURCE_LABEL[r.source] ?? r.source}
                </span>
                {r.pub_date && <span>{r.pub_date.slice(0, 4)}</span>}
                {r.lang && r.lang !== 'ko' && <span>· {r.lang.toUpperCase()}</span>}
                {typeof r.similarity === 'number' && (
                  <span className="ml-auto">관련도 {Math.round(r.similarity * 100)}%</span>
                )}
              </div>

              <h3 className="mt-2 text-sm font-medium">
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {r.title || '(제목 없음)'} ↗
                  </a>
                ) : (
                  (r.title ?? '(제목 없음)')
                )}
              </h3>

              {r.ko_summary && (
                <p className="mt-2 whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
                  {r.ko_summary}
                </p>
              )}

              {r.abstract && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-neutral-400">원문 초록</summary>
                  <p className="mt-1 text-xs leading-relaxed text-neutral-500">{r.abstract}</p>
                </details>
              )}
            </li>
          ))}
        </ul>

        {refs.length === 0 && (
          <p className="mt-4 text-sm text-neutral-400">
            검색 결과가 없습니다. &ldquo;다시 검색&rdquo;을 눌러보세요.
          </p>
        )}
      </section>
    </div>
  )
}

function RelationBadge({ overall }: { overall: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    novel: {
      label: '신규 (차별점)',
      cls: 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400',
    },
    partial: {
      label: '부분 중복',
      cls: 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400',
    },
    known: {
      label: '기존 개시',
      cls: 'border-red-300 text-red-600 dark:border-red-800 dark:text-red-400',
    },
  }
  const v = map[overall] ?? map.novel
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${v.cls}`}>{v.label}</span>
  )
}

function fmtK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-neutral-400">{label}</p>
      <p className="mt-0.5 font-medium text-neutral-700 dark:text-neutral-200">{value}</p>
    </div>
  )
}
