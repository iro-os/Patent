<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 특허 AI (Patent-AI) — project guide

**What:** Turns an inventor's idea + data into a worldwide prior-art research report + a submittable KIPO 명세서/청구항 draft. "Claude Code plan-mode, reskinned for patents." Client: 엑셀바이오 (medical devices), KIPO-first.

**Design source of truth (outside this repo):**
- `.omc/specs/deep-interview-patent-ai-mvp.md` — full UX/workflow/tech spec
- `.omc/plans/patent-ai-mvp-consensus-plan.md` — implementation plan (Architect+Critic approved)
- `.omc/plans/patent-ai-mvp-plan.md` — prior-art sources + patent-law background

**Stack:** Next.js (App Router, TS, Tailwind) · Supabase (Postgres + pgvector + Auth + Storage, per-user RLS) · Claude LLM · prior-art via SerpApi/PubMed/OpenAlex (Phase 1).

**Structure:** `app/` (routes; workspace = sidebar + conversation + Research|Document panel) · `lib/llm` (Claude + grounding validator) · `lib/retrieval` · `lib/embeddings` · `lib/dossier` (3-way merge) · `lib/kipo` (sections + checklist) · `lib/export` · `worker/` (durable deep-research) · `supabase/migrations`.

**Non-negotiable invariants:**
1. **Grounding** — generation cites only from a closed allow-list of real retrieved-ref IDs; a post-generation validator strips/rejects anything else. Never fabricate citations.
2. **Confidentiality** — unpublished invention data: zero-retention LLM AND embeddings; never send payloads to training-enabled/public endpoints; RLS keeps users isolated.
3. **Dossier = source of truth** — the document is a per-section projection; regenerate uses a true 3-way merge (`spec_sections.base_generated_text` ancestor) and flags conflicts; never silently overwrite manual edits; respect `locked`.
4. **Coverage honesty** — always ship a coverage report; never claim 100% prior-art completeness.
5. **KIPO §30** — compute/surface the grace-period deadline when a disclosure date exists.

**Cost controls:** Sonnet for dev/testing, Opus only for production drafting (`PATENT_AI_MODEL`). Fast-pass search by default; the deep agentic loop is opt-in, capped, and runs in `worker/` against `research_jobs` (one active job per project). Free patent-search tiers first.

**Phase:** Phase 0 (foundation) DONE — scaffold + schema + RLS + Google OAuth (login verified end-to-end). Phase 1 **free/safe slice** in progress: Input mode (debrief via Sonnet + clarifying pop-ups + disclosure/§30 clock) + fast-pass worldwide prior-art over **free** DBs (PubMed + OpenAlex) + research report with honest coverage panel. Deferred until the Monday budget call: SerpApi Google Patents, multilingual embeddings (ranking is keyword+recency for now), the durable deep-research worker loop, and Opus. Document surface (3-way merge, claims, export) is Phase 2.
