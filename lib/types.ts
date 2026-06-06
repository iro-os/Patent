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
