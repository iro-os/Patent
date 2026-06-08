-- 0007: conversational thread per invention (Claude-Code-style middle pane).
-- Each turn is a row; structured turns (research/analysis) carry a `data` payload the
-- UI renders specially. RLS via the parent project, like every other child table.
create table if not exists messages (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  role       text not null,                       -- user | assistant
  kind       text not null default 'text',        -- text | research | analysis
  content    text not null default '',
  data       jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_messages_project on messages (project_id, created_at);

alter table messages enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'messages' and policyname = 'messages_via_project'
  ) then
    create policy messages_via_project on messages
      for all
      using (exists (select 1 from projects p where p.id = messages.project_id and p.owner_id = auth.uid()))
      with check (exists (select 1 from projects p where p.id = messages.project_id and p.owner_id = auth.uid()));
  end if;
end $$;
