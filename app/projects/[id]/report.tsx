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

const SOURCE_LABEL: Record<string, string> = {
  pubmed: 'PubMed',
  openalex: 'OpenAlex',
  google_patents: 'Google Patents',
  kipris: 'KIPRIS',
  epo: 'EPO',
}

export function ReportView({
  refs,
  coverage,
  disclosure,
}: {
  refs: RefRow[]
  coverage: CoverageRow | null
  disclosure: DisclosureRow | null
}) {
  const router = useRouter()
  const [rerunning, setRerunning] = useState(false)
  const grace = disclosure?.disclosed
    ? computeGrace(true, disclosure.disclosure_date)
    : null

  const rerun = async () => {
    setRerunning(true)
    try {
      await fetch('/api/research/fast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: window.location.pathname.split('/').pop(),
          disclosed: disclosure?.disclosed ?? false,
          disclosureDate: disclosure?.disclosure_date ?? null,
        }),
      })
      router.refresh()
    } finally {
      setRerunning(false)
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

      {/* Differentiation/overlap analysis is the next sub-step */}
      <p className="rounded-lg border border-dashed border-neutral-300 p-3 text-xs text-neutral-400 dark:border-neutral-700">
        차별성 분석(청구요소 × 선행기술 중복 매트릭스)과 디벨롭 제안은 다음 단계에서 추가됩니다.
        현재는 1차 선행기술 검색 결과를 제공합니다.
      </p>

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
            <li
              key={r.id}
              className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
            >
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
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
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
            검색 결과가 없습니다. 디브리프의 검색어가 너무 좁거나, 무료 학술 DB에 해당 분야 문헌이 적을
            수 있습니다. &ldquo;다시 검색&rdquo;을 눌러보세요.
          </p>
        )}
      </section>
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
