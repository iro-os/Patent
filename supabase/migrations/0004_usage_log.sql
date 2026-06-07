-- 0004: LLM usage telemetry — measured cost per call (replaces estimates).
-- Captured automatically on every Anthropic call from response.usage.

create table if not exists usage_log (
  id                          uuid primary key default gen_random_uuid(),
  project_id                  uuid not null references projects(id) on delete cascade,
  operation                   text not null,   -- debrief | summarize | analyze | (Phase 2: generate_section, claims, chat)
  model                       text not null,
  input_tokens                int not null default 0,   -- uncached input
  output_tokens               int not null default 0,
  cache_creation_input_tokens int not null default 0,   -- written to cache (~1.25x)
  cache_read_input_tokens     int not null default 0,   -- served from cache (~0.1x)
  cost_usd                    numeric(10, 6) not null default 0,
  created_at                  timestamptz not null default now()
);
create index if not exists idx_usage_log_project on usage_log(project_id);

alter table usage_log enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'usage_log' and policyname = 'usage_log_via_project'
  ) then
    create policy usage_log_via_project on usage_log
      for all
      using (exists (select 1 from projects p where p.id = usage_log.project_id and p.owner_id = auth.uid()))
      with check (exists (select 1 from projects p where p.id = usage_log.project_id and p.owner_id = auth.uid()));
  end if;
end $$;
