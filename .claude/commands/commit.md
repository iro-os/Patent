---
description: Write a clean conventional commit message for staged changes
---

# /commit — Write the commit message

Generates a Conventional Commits message for whatever's staged. Does NOT stage files or push — only writes the message.

## Process

1. Run `git status` and `git diff --cached`. If nothing is staged, stop and tell the user.
2. Analyze what the staged changes actually do (not what surrounding context implies).
3. Categorize:
   - `feat` — new user-visible capability
   - `fix` — bug fix
   - `refactor` — structural change, no behavior change
   - `perf` — measurable performance improvement
   - `test` — tests only
   - `docs` — docs only
   - `chore` — build, deps, tooling
4. Write the message:
   - **Subject:** `<type>(<scope>): <imperative subject>` — under 72 chars, no period
   - **Body** (if non-trivial): explain *why*, not *what*. The diff shows what.
   - Wrap body at 72 chars
5. **Do not commit.** Show the message to the user and let them run `git commit -m`.

## Constraints

- One logical change per commit. If the staged diff covers two unrelated changes, refuse and ask the user to split the staging.
- Subject in imperative mood: ✅ "add password reset" / ❌ "added password reset" / ❌ "adds password reset"
- No marketing language ("improve", "enhance" alone — say what specifically)
- Never reference the AI tool, the task description, or specific tickets in the subject — those belong in the PR body. Trailers like `Refs: ABC-123` are fine.

## Example output

```
feat(auth): add password reset via email link

Users could not recover access without contacting support. Adds a
forgot-password flow that emails a signed token (1h TTL) to the
registered address. Token is single-use and invalidated on first
successful reset.

Refs: ABC-123
```
