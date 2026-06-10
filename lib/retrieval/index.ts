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

// 기밀성: 미공개 발명의 핵심 조합이 외부 검색 API로 통째로 나가지 않도록, 외부 전송 질의의
// 단어 수를 제한한다(docs/prior-art-sources-2026 §5 규칙 #3을 코드로 강제). 짧은 facet 개념엔
// 영향이 거의 없고, 길어질 수 있는 광역 자연어 질의만 잘라낸다.
function clampQuery(s: string, maxWords: number): string {
  const words = s.trim().split(/\s+/).filter(Boolean)
  return words.length <= maxWords ? words.join(' ') : words.slice(0, maxWords).join(' ')
}

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
  // 외부 전송 전 기밀성 클램프: 개념 facet은 8단어, 광역 질의는 12단어로 제한.
  const safeConcepts = concepts.map((c) => clampQuery(c, 8)).filter(Boolean)
  const safeBroad = clampQuery(broadQuery, 12)
  const pubmedTerm = safeConcepts.length
    ? safeConcepts.map((c) => `("${c.replace(/"/g, '')}")`).join(' OR ')
    : safeBroad
  const oaConcepts = (safeConcepts.length ? safeConcepts : [safeBroad]).slice(0, 3).filter(Boolean)

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

  // 랭킹 텀 = en + ko 개념어(한국어 ref는 KIPRIS 연동 후 매칭; 지금은 무해). 둘 다 없으면 질의.
  const ko = (opts.concepts?.ko ?? []).map((c) => c.trim()).filter(Boolean)
  const rankTerms = tokenize([...en, ...ko].join(' ') || opts.query)
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
  const stop = new Set(['the', 'and', 'for', 'with', 'device', 'system', 'method', 'using', 'from', 'that', 'this'])
  const out = new Set<string>()
  // 한글은 2자 이상 허용(압력·센서·인솔 등 핵심어가 4자 필터에 잘리던 문제), 영문은 4자+불용어 제외. NFC 정규화.
  for (const w of s.toLowerCase().normalize('NFC').split(/[^a-z0-9가-힣]+/)) {
    if (!w) continue
    const hasHangul = /[가-힣]/.test(w)
    if (hasHangul ? w.length >= 2 : w.length >= 4 && !stop.has(w)) out.add(w)
  }
  return Array.from(out)
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
    // DOI가 가장 강한 교차소스 동일성(PubMed↔OpenAlex 같은 논문 병합). 없으면 제목|연도로,
    // 그것도 없으면 소스 고유 id로 폴백(동명 다른 연도 과병합 방지).
    const norm = normTitle(r.title)
    const year = r.pub_date ? r.pub_date.slice(0, 4) : ''
    const key = r.doi ? `doi:${r.doi}` : norm ? `${norm}|${year}` : `${r.source}:${r.ext_id}`
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
