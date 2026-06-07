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
// One facet sweep: PubMed (OR of quoted concept phrases, single call) + OpenAlex
// (top concepts as separate relevance searches). `concepts` empty → both fall back
// to the broad natural-language query.
async function facetSweep(
  concepts: string[],
  broadQuery: string,
): Promise<{ pubmed: RetrievedRef[]; openalex: RetrievedRef[]; oaQueries: number }> {
  const pubmedTerm = concepts.length
    ? concepts.map((c) => `("${c.replace(/"/g, '')}")`).join(' OR ')
    : broadQuery
  const oaConcepts = (concepts.length ? concepts : [broadQuery]).slice(0, 3).filter(Boolean)

  const [pubmed, ...oaResults] = await Promise.all([
    searchPubmed(pubmedTerm, 20).catch(() => [] as RetrievedRef[]),
    ...oaConcepts.map((c) => searchOpenAlex(c, 8).catch(() => [] as RetrievedRef[])),
  ])
  return { pubmed, openalex: dedupe(oaResults.flat()), oaQueries: oaConcepts.length }
}

export async function searchPriorArt(opts: {
  query: string
  concepts: SearchConcepts
}): Promise<RetrievalResult> {
  const en = (opts.concepts?.en ?? []).map((c) => c.trim()).filter(Boolean)
  const top = en.slice(0, 5)

  let sweep = await facetSweep(top, opts.query)
  let merged = dedupe([...sweep.pubmed, ...sweep.openalex])

  // Second chance: the concept facets force exact-phrase matching, so over-specific
  // or misspelled phrases can legitimately return 0. Before handing the client an
  // empty report, retry once with the broad natural-language query.
  let broadened = false
  if (merged.length === 0 && top.length > 0 && opts.query.trim()) {
    sweep = await facetSweep([], opts.query)
    merged = dedupe([...sweep.pubmed, ...sweep.openalex])
    broadened = true
  }

  const rankTerms = en.length ? tokenize(en.join(' ')) : tokenize(opts.query)
  const ranked = rank(merged, rankTerms).slice(0, MAX_REFS)

  // Coverage honesty (invariant #4): never claim 100%. Real current gaps.
  const blind_spots = [
    '특허 문헌(Google Patents·KIPRIS·EPO) 미포함 — 현재 무료 학술 DB(PubMed·OpenAlex)만 검색합니다. 특허 검색은 예산 확정 후 추가됩니다.',
    '비영어·비색인 문헌은 누락될 수 있습니다.',
    '키워드 기반 1차(fast-pass) 검색입니다 — 의미 기반(임베딩) 검색과 심층 에이전트 루프는 아직 적용되지 않았습니다.',
  ]
  if (broadened) {
    blind_spots.unshift(
      '구체적 개념 검색이 0건이라 일반 질의로 확장 검색했습니다 — 적합도가 낮을 수 있습니다.',
    )
  }
  if (merged.length === 0) {
    blind_spots.unshift(
      '선행기술 검색 결과가 0건입니다 — 검색어를 구체화하거나 변리사 검토가 필요합니다.',
    )
  }

  return {
    refs: ranked,
    coverage: {
      sources_searched: [
        { source: 'pubmed', queries: 1 },
        { source: 'openalex', queries: sweep.oaQueries },
      ],
      date_ranges: { pubmed: dateRange(sweep.pubmed), openalex: dateRange(sweep.openalex) },
      screened_count: merged.length,
      blind_spots,
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
    // Qualify the title key with year so distinct same-titled works ("Editorial",
    // "Correction", a reply published in a different year) are not collapsed into one.
    // Empty/punctuation-only titles fall back to the source-native id (always unique).
    const norm = normTitle(r.title)
    const year = r.pub_date ? r.pub_date.slice(0, 4) : ''
    const key = norm ? `${norm}|${year}` : `${r.source}:${r.ext_id}`
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
