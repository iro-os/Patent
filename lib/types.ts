// Core dossier types (the canonical state both surfaces project from).
// DB-generated types will be added via `supabase gen types` once the project is live.

export type ProjectStatus =
  | 'draft_intake'
  | 'ready'
  | 'researching'
  | 'report_ready'
  | 'doc_generated'
  | 'refining'
  | 'exported'

export type PriorArtSource = 'google_patents' | 'pubmed' | 'openalex' | 'kipris' | 'epo'

export type OverlapRelation = 'discloses' | 'partial' | 'novel'

export type ClaimType = '독립' | '종속'

export interface PriorArtRef {
  id: string
  source: PriorArtSource
  ext_id: string
  url?: string
  pub_date?: string
  lang?: string
  title?: string
  abstract?: string
  ko_summary?: string
  similarity?: number
}

export interface CoverageReport {
  sources_searched: { source: PriorArtSource; queries: number }[]
  date_ranges: Record<string, string>
  screened_count: number
  confidence_by_area: Record<string, number>
  blind_spots: string[] // honest "possible gaps" — never claims 100%
}

// 3-way merge inputs for a 명세서 section (see 0001_init.sql).
export interface SpecSection {
  schema_key: string
  base_generated_text?: string // ANCESTOR
  generated_text?: string // latest model output
  manual_override?: string // user edit
  locked: boolean
  version: number
}

export type MergeOutcome = 'take_new' | 'keep_manual' | 'conflict' | 'skipped_locked'

// ── Input mode: debrief (§14.1) ─────────────────────────────────────────────
// Prior art is worldwide by law, but PubMed/OpenAlex are English DBs — so the
// debrief must also produce English search terms (§14.3 KR+EN concept extraction).
export interface SearchConcepts {
  ko: string[]
  en: string[]
}

export interface ClarifyingQuestion {
  id?: string
  question: string
  options: string[]
  answer?: string
}

// The AI scores these internally; each missing/weak item drives a clarifying question.
export interface ReadinessChecklist {
  core_problem: boolean
  technical_solution: boolean
  embodiment: boolean
  differentiator: boolean
  disclosure_status: boolean
}

export interface DebriefResult {
  title_guess: string
  tech_summary: string
  problem: string
  differentiators: string
  ipc_candidates: string[]
  missing_items: string[]
  search_query_en: string // focused natural-language query for PubMed/OpenAlex
  search_concepts: SearchConcepts
  clarifying_questions: ClarifyingQuestion[]
  readiness: ReadinessChecklist
}

// ── Retrieval (pre-persistence shape returned by the free adapters) ──────────
export interface RetrievedRef {
  source: PriorArtSource
  ext_id: string
  url?: string
  pub_date?: string // normalized to YYYY-MM-DD (or undefined)
  lang?: string
  title?: string
  abstract?: string
  score?: number // 0..1 baseline relevance (keyword overlap + recency; embeddings later)
}

// ── KIPO §30 grace-period clock ─────────────────────────────────────────────
export interface GraceInfo {
  disclosed: boolean
  disclosure_date?: string
  grace_deadline?: string // disclosure_date + 12 months
  days_remaining?: number
  expired?: boolean
}
