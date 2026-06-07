-- 0005: durability against concurrent / retried research runs.
-- The fast route replaces a project's prior_art_refs (delete-then-insert). Two
-- overlapping runs (double-submit, retry) could otherwise interleave into duplicate
-- rows, which inflates the grounding ref numbering ([1..N]) in the analyze step.
-- Enforce one row per (project, source, ext_id). De-dup any existing rows first so
-- the unique index can be created on live data.

delete from prior_art_refs a
  using prior_art_refs b
 where a.ctid < b.ctid
   and a.project_id = b.project_id
   and a.source = b.source
   and a.ext_id = b.ext_id;

create unique index if not exists uniq_prior_art_project_source_extid
  on prior_art_refs (project_id, source, ext_id);
