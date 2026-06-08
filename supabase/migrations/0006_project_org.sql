-- 0006: sidebar organization — pin an invention to the top and move it into a group.
-- Non-destructive additive columns (RLS unchanged; still owner-scoped via projects policy).
alter table projects add column if not exists pinned boolean not null default false;
alter table projects add column if not exists group_name text;

create index if not exists idx_projects_owner_pinned on projects (owner_id, pinned, updated_at desc);
