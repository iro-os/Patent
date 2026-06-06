---
description: Provide structured context to Claude before a non-trivial request
---

# /context — Give Claude the right context

Use before a complex task to avoid "AI guesses wrong" failures. This command produces a structured context block the user can paste into the next prompt, OR if Claude already has filesystem access, reads the relevant files itself.

## What Claude should gather

Walk through these categories. For each, either include or explicitly say "N/A":

### 1. Task
- **What:** one sentence describing what the user wants done
- **Why:** the business / user reason (not "tech debt" — actual outcome)
- **Done criteria:** how we know it's finished (observable, not aspirational)

### 2. Code anchors
Files Claude should read before writing anything:
- The file(s) being changed
- Files that import/call them (find usages)
- Adjacent files with similar patterns (so the new code matches existing style)
- Tests for the area

### 3. Data
- What inputs the code receives (types, shapes, validated by what)
- What outputs / side effects it produces
- External APIs / DB tables touched

### 4. Constraints
- Performance budget (latency, memory)
- Compatibility (browsers, runtime versions, API consumers)
- Security (auth required? PII handling? rate limits?)
- Style (existing patterns to match, conventions to follow)

### 5. Out-of-scope
What looks related but isn't part of this task. Naming it prevents drift.

### 6. Examples (when helpful)
- A similar feature already in the codebase to mirror
- A sample input → expected output pair
- A failing test case the new code needs to handle

## Output format

Produce a markdown block the user can paste verbatim into the next prompt:

```markdown
## Task
[...]

## Files to read first
- path/to/file1
- path/to/file2

## Constraints
- [...]

## Out of scope
- [...]
```

## When NOT to use this command

- Trivial changes (typo fixes, single-line tweaks) — overhead exceeds benefit
- Exploratory questions ("what does this code do?") — just ask directly
- When `planning/plan.md` already exists — read that instead, don't duplicate
