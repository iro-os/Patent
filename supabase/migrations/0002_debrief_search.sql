-- 0002: Phase 1 Input-mode support
-- (a) persist the debrief's worldwide-search terms (English) for the fast pass,
-- (b) one-row-per-project uniqueness so debrief/disclosure upserts are idempotent.

alter table debrief add column if not exists search_query_en text;
alter table debrief add column if not exists search_concepts jsonb not null default '{}';

-- Unique (project_id) so `upsert(..., onConflict: project_id)` works (idempotent re-runs).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'debrief_project_unique') then
    alter table debrief add constraint debrief_project_unique unique (project_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'disclosure_project_unique') then
    alter table disclosure_check add constraint disclosure_project_unique unique (project_id);
  end if;
end $$;
