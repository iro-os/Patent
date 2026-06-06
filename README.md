# 특허 AI (Patent-AI)

Turns an inventor's idea + data into a **worldwide prior-art research report** and a **submittable KIPO 명세서/청구항** draft — refined via chat + manual edits. "Claude Code plan-mode, reskinned for patents."

> Client engagement: 엑셀바이오 (medical devices). KIPO-first. First test case: 「혈청 안약 안경」.

## Status
**Phase 0 (foundation) — in progress.** Scaffold + DB schema + Google auth. Intelligent features (prior-art research, document generation) arrive in Phase 1.

## Stack
- Next.js (App Router) + TypeScript + Tailwind
- Supabase (Postgres + pgvector + Auth + Storage), per-user RLS isolation
- Claude (LLM) — Sonnet for dev, Opus for production drafting (`PATENT_AI_MODEL`)
- Prior-art (Phase 1): Google Patents (SerpApi) + PubMed + OpenAlex; KIPRIS/EPO later

## Setup
1. `cp .env.local.example .env.local` and fill the values (Supabase URL/keys, Anthropic, etc.).
2. Apply the schema: run `supabase/migrations/0001_init.sql` against your Supabase project (or `supabase db push`).
3. In the Supabase dashboard: **Authentication → Providers → Google** — add a Google OAuth client (Google Cloud Console) ID + secret, and set the redirect URL to `<app-url>/auth/callback`.
4. `npm install && npm run dev` → http://localhost:3000

## Planning artifacts (design source of truth)
The full spec, consensus plan, and prior-art/patent-law background live outside this repo at:
- `.omc/specs/deep-interview-patent-ai-mvp.md`
- `.omc/plans/patent-ai-mvp-consensus-plan.md`
- `.omc/plans/patent-ai-mvp-plan.md`

## Key invariants (do not violate)
- **Grounding:** generation cites only from real retrieved refs (closed allow-list + post-gen validator). Never fabricate citations.
- **Confidentiality:** unpublished invention data — zero-retention LLM **and** embeddings; never log payloads to public endpoints.
- **Dossier = source of truth:** the document is a per-section projection; regenerate uses a true 3-way merge (`base_generated_text` ancestor) and flags conflicts — never silently overwrites manual edits.
- **Coverage honesty:** prior-art results always ship a coverage report; never claim 100% completeness.
