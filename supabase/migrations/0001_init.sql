-- Patent-AI MVP — initial schema
-- Design source: .omc/specs/deep-interview-patent-ai-mvp.md + consensus plan (Architect/Critic hardened)
-- Principles baked in: per-user RLS isolation, dossier=source-of-truth, true 3-way merge (base_generated_text),
-- durable research jobs (+ per-project idempotency), multilingual embeddings via pgvector.

-- ── Extensions ──────────────────────────────────────────────────────────────
create extension if not exists vector;      -- pgvector for multilingual prior-art embeddings

-- Embedding dimension: 1024 = Voyage multilingual / Cohere multilingual.
-- If you switch to OpenAI text-embedding-3 (1536), change vector(1024) accordingly.

-- ── Helper: updated_at trigger ──────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

-- ── projects (top-level owner anchor for RLS) ───────────────────────────────
create table projects (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  title       text not null default '제목 없는 발명',
  jurisdiction text not null default 'KR',            -- KIPO-first; template-driven for US/PCT later
  status      text not null default 'draft_intake',   -- draft_intake|ready|researching|report_ready|doc_generated|refining|exported
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_projects_updated before update on projects
  for each row execute function set_updated_at();

-- ── intake ──────────────────────────────────────────────────────────────────
create table intake_inputs (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  kind       text not null default 'text',            -- text|file
  content    text,                                     -- pasted idea / verbal explanation
  file_path  text,                                     -- Supabase Storage path (uploaded data/drawings)
  parse_status text not null default 'ok',             -- ok|failed (ingest-failure path)
  created_at timestamptz not null default now()
);

create table disclosure_check (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  disclosed       boolean not null default false,      -- has it been publicly shown/sold/published?
  disclosure_date date,                                -- earliest public disclosure
  channel         text,                                -- where (paper, sale, demo, ...)
  grace_deadline  date generated always as (           -- KR §30: disclosure + 12 months
                    case when disclosure_date is not null
                         then (disclosure_date + interval '12 months')::date end) stored,
  notes           text,
  created_at      timestamptz not null default now()
);

create table debrief (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  title_guess   text,
  tech_summary  text,
  problem       text,
  differentiators text,
  ipc_candidates  text[],
  missing_items jsonb not null default '[]',
  created_at    timestamptz not null default now()
);

create table clarifying_qa (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  question   text not null,
  options    jsonb not null default '[]',
  answer     text,
  created_at timestamptz not null default now()
);

-- ── retrieval / evidence base ───────────────────────────────────────────────
create table prior_art_refs (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  source     text not null,                            -- google_patents|pubmed|openalex|kipris|epo
  ext_id     text not null,                            -- source-native id (for dedupe/grounding allow-list)
  url        text,
  pub_date   date,
  lang       text,
  title      text,
  abstract   text,
  ko_summary text,                                     -- Korean summary for foreign refs (§14.3)
  similarity real,
  embedding  vector(1024),
  raw        jsonb,
  created_at timestamptz not null default now()
);
create index idx_prior_art_project on prior_art_refs(project_id);
create index idx_prior_art_embedding on prior_art_refs using hnsw (embedding vector_cosine_ops);

create table overlap_matrix (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  element    text not null,                            -- an element of the invention
  ref_id     uuid references prior_art_refs(id) on delete set null,
  relation   text not null,                            -- discloses|partial|novel
  note       text
);

create table differentiation_points (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  point      text not null,
  supporting_ref_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table develop_suggestions (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  suggestion text not null,
  kind       text not null default 'design',          -- experiment|data|design
  rationale  text,                                     -- tied to an inventive-step gap
  created_at timestamptz not null default now()
);

create table coverage_report (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references projects(id) on delete cascade,
  sources_searched   jsonb not null default '[]',
  date_ranges        jsonb not null default '{}',
  screened_count     int not null default 0,
  confidence_by_area jsonb not null default '{}',
  blind_spots        jsonb not null default '[]',      -- honest "possible gaps"; never claims 100%
  created_at         timestamptz not null default now()
);

-- ── document surface (dossier projection) ───────────────────────────────────
-- True 3-way merge needs the common ancestor (base_generated_text) so we can tell
-- "user edited" from "model changed" and never silently overwrite manual work.
create table spec_sections (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references projects(id) on delete cascade,
  schema_key         text not null,                    -- e.g. 기술분야, 배경기술, 청구범위 ...
  base_generated_text text,                            -- ANCESTOR: the generation the manual edit was based on
  generated_text     text,                             -- latest model generation
  manual_override    text,                             -- user's manual edit (theirs)
  locked             boolean not null default false,   -- skip on regenerate
  version            int not null default 1,
  updated_at         timestamptz not null default now(),
  unique (project_id, schema_key)
);
create trigger trg_spec_sections_updated before update on spec_sections
  for each row execute function set_updated_at();

create table claims (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects(id) on delete cascade,
  claim_type        text not null,                     -- 독립 | 종속
  number            int not null,
  parent_number     int,                               -- for 종속항 (references which claim)
  text              text not null default '',
  version           int not null default 1,
  consistency_flags jsonb not null default '[]',       -- antecedent-basis / 기재불비 warnings
  updated_at        timestamptz not null default now()
);
create trigger trg_claims_updated before update on claims
  for each row execute function set_updated_at();

-- ── audit + export ──────────────────────────────────────────────────────────
create table change_log (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  actor      text not null,                            -- ai | human
  action     text not null,
  prompt     text,                                     -- the chat prompt that caused an AI change
  before     text,
  after      text,
  ref_ids    jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table exports (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  format     text not null,                            -- docx|pdf|hwp
  file_path  text,
  created_at timestamptz not null default now()
);

-- ── durable deep-research jobs (Architect P0-1) ─────────────────────────────
create table research_jobs (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  status          text not null default 'queued',      -- queued|running|succeeded|failed|cancelled
  stage           text,                                -- checkpoint stage for resume-after-timeout
  progress        int not null default 0,
  partial_results jsonb not null default '{}',
  budget_spent    numeric not null default 0,          -- cost guard
  heartbeat_at    timestamptz,
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_research_jobs_updated before update on research_jobs
  for each row execute function set_updated_at();
-- Idempotency: at most one active job per project (prevents double-enqueue / double SerpApi spend)
create unique index uniq_active_research_job on research_jobs(project_id)
  where status in ('queued','running');

-- ── Row-Level Security: every user sees only their own projects ─────────────
alter table projects               enable row level security;
alter table intake_inputs          enable row level security;
alter table disclosure_check       enable row level security;
alter table debrief                enable row level security;
alter table clarifying_qa          enable row level security;
alter table prior_art_refs         enable row level security;
alter table overlap_matrix         enable row level security;
alter table differentiation_points enable row level security;
alter table develop_suggestions    enable row level security;
alter table coverage_report        enable row level security;
alter table spec_sections          enable row level security;
alter table claims                 enable row level security;
alter table change_log             enable row level security;
alter table exports                enable row level security;
alter table research_jobs          enable row level security;

-- projects: owner-only
create policy projects_owner on projects
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- child tables: ownership via parent project
do $$
declare t text;
begin
  foreach t in array array[
    'intake_inputs','disclosure_check','debrief','clarifying_qa','prior_art_refs',
    'overlap_matrix','differentiation_points','develop_suggestions','coverage_report',
    'spec_sections','claims','change_log','exports','research_jobs'
  ] loop
    execute format($f$
      create policy %1$s_via_project on %1$s
        for all
        using (exists (select 1 from projects p where p.id = %1$s.project_id and p.owner_id = auth.uid()))
        with check (exists (select 1 from projects p where p.id = %1$s.project_id and p.owner_id = auth.uid()));
    $f$, t);
  end loop;
end $$;
