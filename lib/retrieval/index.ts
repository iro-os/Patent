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

const MAX_REFS = 25 // cap the fast-pass report size

// Fast pass (R6): facet search across the free DBs, dedupe, rank.
// IMPORTANT: one giant query ANDs every term and returns 0 (PubMed auto-ANDs;
// OpenAlex chokes on very long strings). So we split the debrief's concept
// phrases into facets — PubMed gets an OR of quoted phrases (one call), OpenAlex
// runs the top concepts as separate relevance searches — then merge.
export async function searchPriorArt(opts: {
  query: string
  concepts: SearchConcepts
}): Promise<RetrievalResult> {
  const en = (opts.concepts?.en ?? []).map((c) => c.trim()).filter(Boolean)
  const top = en.slice(0, 5)

  // PubMed: OR of quoted concept phrases (broad recall in a single call).
  const pubmedTerm = top.length
    ? top.map((c) => `("${c.replace(/"/g, '')}")`).join(' OR ')
    : opts.query
  // OpenAlex: top concepts as separate relevance searches (no good boolean OR in `search`).
  const oaConcepts = (top.length ? top : [opts.query]).slice(0, 3).filter(Boolean)

  const [pubmed, ...oaResults] = await Promise.all([
    searchPubmed(pubmedTerm, 20).catch(() => [] as RetrievedRef[]),
    ...oaConcepts.map((c) => searchOpenAlex(c, 8).catch(() => [] as RetrievedRef[])),
  ])
  const openalex = dedupe(oaResults.flat())

  const merged = dedupe([...pubmed, ...openalex])
  const rankTerms = en.length ? tokenize(en.join(' ')) : tokenize(opts.query)
  const ranked = rank(merged, rankTerms).slice(0, MAX_REFS)

  return {
    refs: ranked,
    coverage: {
      sources_searched: [
        { source: 'pubmed', queries: 1 },
        { source: 'openalex', queries: oaConcepts.length },
      ],
      date_ranges: { pubmed: dateRange(pubmed), openalex: dateRange(openalex) },
      screened_count: merged.length,
      // Coverage honesty (invariant #4): never claim 100%. Real current gaps.
      blind_spots: [
        '특허 문헌(Google Patents·KIPRIS·EPO) 미포함 — 현재 무료 학술 DB(PubMed·OpenAlex)만 검색합니다. 특허 검색은 예산 확정 후 추가됩니다.',
        '비영어·비색인 문헌은 누락될 수 있습니다.',
        '키워드 기반 1차(fast-pass) 검색입니다 — 의미 기반(임베딩) 검색과 심층 에이전트 루프는 아직 적용되지 않았습니다.',
      ],
    },
  }
}

// Ranking terms = individual significant words from the concept phrases.
// (Multi-word phrases rarely appear verbatim in a title, so we score on words.)
function tokenize(s: string): string[] {
  const stop = new Set(['the', 'and', 'for', 'with', 'device', 'system', 'method', 'using'])
  return Array.from(
    new Set(
      s
        .toLowerCase()
        .split(/[^a-z0-9가-힣]+/)
        .filter((w) => w.length >= 4 && !stop.has(w)),
    ),
  )
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
  const low = terms.filter(Boolean)
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
