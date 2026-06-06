import type { RetrievedRef, SearchConcepts } from '@/lib/types'
import { searchPubmed } from './pubmed'
import { searchOpenAlex } from './openalex'

export interface RetrievalResult {
  refs: RetrievedRef[]
  coverage: {
    sources_searched: { source: string; queries: number }[]
    date_ranges: Record<string, string>
    screened_count: number
    blind_spots: string[]
  }
}

// Fast pass (R6): one multi-source query across the free DBs, dedupe, rank.
// Deep agentic loop (SerpApi patents + Opus) is deferred until the budget is set.
export async function searchPriorArt(opts: {
  query: string
  concepts: SearchConcepts
}): Promise<RetrievalResult> {
  const [pubmed, openalex] = await Promise.all([
    searchPubmed(opts.query).catch(() => [] as RetrievedRef[]),
    searchOpenAlex(opts.query).catch(() => [] as RetrievedRef[]),
  ])

  const merged = dedupe([...pubmed, ...openalex])
  const ranked = rank(merged, opts.concepts?.en ?? [])

  return {
    refs: ranked,
    coverage: {
      sources_searched: [
        { source: 'pubmed', queries: 1 },
        { source: 'openalex', queries: 1 },
      ],
      date_ranges: { pubmed: dateRange(pubmed), openalex: dateRange(openalex) },
      screened_count: merged.length,
      // Coverage honesty (invariant #4): never claim 100%. These are the real,
      // current gaps of the free-tier fast pass.
      blind_spots: [
        '특허 문헌(Google Patents·KIPRIS·EPO) 미포함 — 현재 무료 학술 DB(PubMed·OpenAlex)만 검색합니다. 특허 검색은 예산 확정 후 추가됩니다.',
        '비영어·비색인 문헌은 누락될 수 있습니다.',
        '키워드 기반 1차(fast-pass) 검색입니다 — 의미 기반(임베딩) 검색과 심층 에이전트 루프는 아직 적용되지 않았습니다.',
      ],
    },
  }
}

function normTitle(t?: string): string {
  return (t ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, ' ')
    .trim()
}

function dedupe(refs: RetrievedRef[]): RetrievedRef[] {
  const seen = new Set<string>()
  const out: RetrievedRef[] = []
  for (const r of refs) {
    const key = normTitle(r.title) || `${r.source}:${r.ext_id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

// Baseline relevance: keyword overlap (title weighted 2×) + a mild recency bonus.
// Deterministic and key-free; multilingual embedding similarity replaces this later.
function rank(refs: RetrievedRef[], terms: string[]): RetrievedRef[] {
  const low = terms.map((t) => t.toLowerCase()).filter(Boolean)
  const thisYear = new Date().getFullYear()
  for (const r of refs) {
    const title = (r.title ?? '').toLowerCase()
    const abs = (r.abstract ?? '').toLowerCase()
    let overlap = 0
    for (const t of low) {
      if (title.includes(t)) overlap += 2
      else if (abs.includes(t)) overlap += 1
    }
    const kw = low.length ? Math.min(overlap / (low.length * 2), 1) : 0
    const year = r.pub_date ? parseInt(r.pub_date.slice(0, 4)) : undefined
    const recency = year ? Math.max(0, Math.min(1, (year - (thisYear - 25)) / 25)) : 0.3
    r.score = Math.round((kw * 0.8 + recency * 0.2) * 1000) / 1000
  }
  return refs.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
}

function dateRange(refs: RetrievedRef[]): string {
  const years = refs
    .map((r) => (r.pub_date ? parseInt(r.pub_date.slice(0, 4)) : NaN))
    .filter((y) => !isNaN(y))
  if (!years.length) return 'N/A'
  return `${Math.min(...years)}–${Math.max(...years)}`
}
