# iro-os — Project Context for Claude Code

> This file is shared org-wide. It is loaded automatically by Claude Code when working
> in any iro-os repository. Keep it focused on conventions that apply across the org;
> put repo-specific details in that repo's own `CLAUDE.md`.

## How we work with Claude Code

- This repo ships a shared Claude Code setup via `.claude/` and `.mcp.json`. When you
  open it and trust the folder, Claude Code will prompt you to install the org's plugins.
- Personal preferences belong in `.claude/settings.local.json` (gitignored), not in the
  committed `.claude/settings.json`.
- Secrets never go in committed files. Use environment variables or
  `.claude/settings.local.json`.

## Conventions

<!-- Fill in org-wide conventions here. Examples: -->
<!-- - Language / framework defaults -->
<!-- - Commit message style (see /commit) -->
<!-- - Testing expectations (see /test-driven-development) -->
<!-- - Security baseline (see /security-checklist) -->

## Available custom commands & skills

Shared via `.claude/commands/` and `.claude/skills/`:

- `/commit` — clean conventional commit message for staged changes
- `/context` — provide structured context before a non-trivial request
- `/optimize` — suggest runnable commands derived from codebase docs
- `/plan` — draft or update `plan.md` for an upcoming change
- `/security-checklist` — audit the project's security posture
- `code-reviewer` skill — code review (PR review, quality analysis)
- `react-component` skill — generate React components matching team conventions
- `test-driven-development` skill — TDD workflow for React/TypeScript

> Note: oh-my-claudecode (OMC) and the official plugins also provide their own agents,
> skills, and slash commands once installed.
