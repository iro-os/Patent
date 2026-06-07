-- 0003: claim strategy (R7 — "strategy in Develop, text in Document").
-- The Develop surface stores how broad the 독립항 can be + a 종속항 ladder;
-- the actual claim TEXT is generated later in the Document surface (Phase 2).

create table if not exists claim_strategy (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects(id) on delete cascade,
  independent_scope text,                       -- how broad the independent claim can safely be
  dependent_ladder jsonb not null default '[]', -- ordered list of 종속항 features (from surviving differentiators)
  created_at       timestamptz not null default now(),
  unique (project_id)
);

alter table claim_strategy enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'claim_strategy' and policyname = 'claim_strategy_via_project'
  ) then
    create policy claim_strategy_via_project on claim_strategy
      for all
      using (exists (select 1 from projects p where p.id = claim_strategy.project_id and p.owner_id = auth.uid()))
      with check (exists (select 1 from projects p where p.id = claim_strategy.project_id and p.owner_id = auth.uid()));
  end if;
end $$;
