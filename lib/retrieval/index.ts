import type { RetrievedRef, SearchConcepts } from '@/lib/types'
import { searchPubmed } from './pubmed'
import { searchOpenAlex } from './openalex'
import { searchKipris } from './kipris'

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
// (export: KIPRIS 등 다른 어댑터도 동일 기밀 클램프 규율을 재사용한다.)
export function clampQuery(s: string, maxWords: number): string {
  const words = s.trim().split(/\s+/).filter(Boolean)
  return words.length <= maxWords ? words.join(' ') : words.slice(0, maxWords).join(' ')
}

// ── PriorArtAdapter 레지스트리 ────────────────────────────────────────────────
// 선행조사 소스를 공통 인터페이스로 추상화한다. enabled()가 false면 호출조차 안 한다
// (env 게이트). 새 소스(EPO/WIPS 등)는 이 배열에 한 줄 추가하면 무중단으로 합류한다.
// 기존 pubmed/openalex 호출 로직은 그대로 두고 어댑터로 감싸기만 한다(과설계 금지).
export interface AdapterInput {
  // 이미 기밀 클램프된 영어 개념 facet (PubMed OR 검색 / OpenAlex relevance 검색용).
  safeConcepts: string[]
  // 이미 기밀 클램프된 광역 영어 질의 (facet이 0건일 때 폴백).
  safeBroad: string
  // 이미 기밀 클램프된 한국어 개념 (KIPRIS 키워드용). 없으면 safeBroad로 폴백.
  safeKoConcepts: string[]
}

export interface PriorArtAdapter {
  id: string // RetrievedRef.source 와 일치하는 머신 id
  label: string // coverage.sources_searched 에 노출되는 표시명
  enabled(): boolean // env 게이트 — false면 스킵(현 동작 유지)
  // 검색 실행. 어댑터는 자체적으로 오류를 삼켜 [] 를 반환해야 한다(한 소스 실패가 전체를 깨지 않음).
  // queries: 이 어댑터가 실제 외부로 보낸 질의 수(coverage 정직성 — 동적 집계).
  search(input: AdapterInput): Promise<{ refs: RetrievedRef[]; queries: number }>
}

const ADAPTERS: PriorArtAdapter[] = [
  {
    id: 'pubmed',
    label: 'pubmed',
    enabled: () => true, // 무료·키 불필요 (PUBMED_API_KEY는 레이트리밋만 상향)
    async search({ safeConcepts, safeBroad }) {
      // 한 번의 호출로 개념 phrase들을 OR 결합 (긴 단일 질의는 auto-AND로 0건이 됨).
      const term = safeConcepts.length
        ? safeConcepts.map((c) => `("${c.replace(/"/g, '')}")`).join(' OR ')
        : safeBroad
      const refs = await searchPubmed(term, 20).catch(() => [] as RetrievedRef[])
      return { refs, queries: 1 }
    },
  },
  {
    id: 'openalex',
    label: 'openalex',
    enabled: () => true, // 무료·키 불필요
    async search({ safeConcepts, safeBroad }) {
      // 상위 개념을 각각 relevance 검색 (OpenAlex는 매우 긴 문자열에서 결과가 무너짐).
      const oaConcepts = (safeConcepts.length ? safeConcepts : [safeBroad])
        .slice(0, 3)
        .filter(Boolean)
      const results = await Promise.all(
        oaConcepts.map((c) => searchOpenAlex(c, 8).catch(() => [] as RetrievedRef[])),
      )
      return { refs: dedupe(results.flat()), queries: oaConcepts.length }
    },
  },
  {
    id: 'kipris',
    label: 'KIPRIS',
    // env 게이트: 키가 있을 때만 활성. 없으면 현 동작과 100% 동일(no-op).
    enabled: () => !!process.env.KIPRIS_PLUS_KEY,
    async search({ safeKoConcepts, safeBroad }) {
      // KIPRIS는 한국어 자유검색 1건. 한국어 개념을 OR로 묶으면 0건 위험이 커서, 상위 개념
      // 하나(없으면 광역 질의)로 검색한다. searchKipris는 키 없으면/오류면 자체적으로 [] 반환.
      const word = safeKoConcepts[0] || safeBroad
      const refs = await searchKipris({ word, numOfRows: 20 })
      return { refs, queries: word ? 1 : 0 }
    },
  },
]

// Fast pass (R6): facet search across the free DBs, dedupe, rank.
// IMPORTANT: one giant query ANDs every term and returns 0 (PubMed auto-ANDs;
// OpenAlex chokes on very long strings). So we split the debrief's concept
// One sweep across the ENABLED adapters. Each adapter (pubmed/openalex/kipris) gets the
// same clamped input and self-degrades to [] on failure, so one dead source never sinks
// the run. Returns per-source results keyed by adapter id (drives dynamic coverage).
// `concepts` empty → adapters fall back to the broad natural-language query.
interface SourceRun {
  label: string
  refs: RetrievedRef[]
  queries: number
}
async function adapterSweep(
  concepts: string[],
  koConcepts: string[],
  broadQuery: string,
): Promise<Map<string, SourceRun>> {
  // 외부 전송 전 기밀성 클램프: 개념 facet 8단어, 광역 질의 12단어 (KIPRIS 한국어 개념도 동일 규율).
  const input: AdapterInput = {
    safeConcepts: concepts.map((c) => clampQuery(c, 8)).filter(Boolean),
    safeBroad: clampQuery(broadQuery, 12),
    safeKoConcepts: koConcepts.map((c) => clampQuery(c, 8)).filter(Boolean),
  }
  const active = ADAPTERS.filter((a) => a.enabled())
  const settled = await Promise.allSettled(active.map((a) => a.search(input)))

  const perSource = new Map<string, SourceRun>()
  active.forEach((adapter, i) => {
    const r = settled[i]
    // allSettled + 어댑터 자체 catch의 이중 안전망: 무엇이 터져도 그 소스만 0건으로 기록.
    const out = r.status === 'fulfilled' ? r.value : { refs: [] as RetrievedRef[], queries: 0 }
    perSource.set(adapter.id, { label: adapter.label, refs: out.refs, queries: out.queries })
  })
  return perSource
}

function mergeRuns(perSource: Map<string, SourceRun>): RetrievedRef[] {
  const all: RetrievedRef[] = []
  for (const run of perSource.values()) all.push(...run.refs)
  return dedupe(all)
}

export async function searchPriorArt(opts: {
  query: string
  concepts: SearchConcepts
}): Promise<RetrievalResult> {
  const en = (opts.concepts?.en ?? []).map((c) => c.trim()).filter(Boolean)
  const ko = (opts.concepts?.ko ?? []).map((c) => c.trim()).filter(Boolean)
  const top = en.slice(0, 5)
  const koTop = ko.slice(0, 5)

  let perSource = await adapterSweep(top, koTop, opts.query)
  let merged = mergeRuns(perSource)

  // Second chance: the concept facets force exact-phrase matching, so over-specific
  // or misspelled phrases can legitimately return 0. Before handing the client an
  // empty report, retry once with the broad natural-language query.
  let broadened = false
  if (merged.length === 0 && (top.length > 0 || koTop.length > 0) && opts.query.trim()) {
    perSource = await adapterSweep([], [], opts.query)
    merged = mergeRuns(perSource)
    broadened = true
  }

  // 랭킹 텀 = en + ko 개념어 (KIPRIS 한국어 ref는 ko 텀으로 매칭됨). 둘 다 없으면 질의.
  const rankTerms = tokenize([...en, ...ko].join(' ') || opts.query)
  const ranked = rank(merged, rankTerms).slice(0, MAX_REFS)

  // 어떤 소스가 실제로 돌았는지 (coverage 정직성 — 동적 집계).
  const ranKipris = perSource.has('kipris')

  // Coverage honesty (invariant #4): never claim 100%. Real current gaps.
  // KIPRIS가 실제로 돌면 '미포함' 문구에서 KIPRIS를 빼서 거짓 누락 주장 방지.
  const missingPatentDbs = ranKipris ? 'Google Patents·EPO' : 'Google Patents·KIPRIS·EPO'
  const patentLine = ranKipris
    ? `특허 문헌 일부 미포함 (${missingPatentDbs}) — 한국 특허·실용신안은 KIPRIS로 검색하며, 그 외 해외 특허 DB는 예산 확정 후 추가됩니다.`
    : `특허 문헌(${missingPatentDbs}) 미포함 — 현재 무료 학술 DB(PubMed·OpenAlex)만 검색합니다. 특허 검색은 예산 확정 후 추가됩니다.`
  const blind_spots = [
    patentLine,
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

  // 동적 coverage: 실제로 돈 어댑터만, 그 표시명/질의수/연도범위로 집계.
  const sources_searched: { source: string; queries: number }[] = []
  const date_ranges: Record<string, string> = {}
  for (const [id, run] of perSource) {
    sources_searched.push({ source: run.label, queries: run.queries })
    date_ranges[id] = dateRange(run.refs)
  }

  return {
    refs: ranked,
    coverage: {
      sources_searched,
      date_ranges,
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
