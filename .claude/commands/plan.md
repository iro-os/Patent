---
description: Draft or update plan.md for the upcoming change
---

# /plan — Plan before code

You will help draft a `planning/plan.md` for the change the user is about to make. Follow the template at `planning/plan.md.template` in this repo (read it first if you haven't).

## Process

1. **Ask first if anything is unclear.** Do not invent a goal. If the user said "/plan" with no context, ask: what are we building, why, and what does done look like?
2. **Read before writing.** Look at related code in the repo. Don't propose a design that contradicts an existing pattern without flagging the contradiction.
3. **Fill the template, not every section.** Empty sections are fine. Pad-filling sections you don't have answers for is worse than leaving them blank — it creates fake confidence.
4. **Push back on scope.** If the user describes a 3-file change as one step, split it. If they describe four unrelated changes as one feature, separate them.
5. **Output the plan as a file at `planning/plan.md`.** If a plan.md already exists for an in-progress change, ask before overwriting.

## What "good" looks like

- Done criteria are observable (a test, a screenshot, a curl command), not aspirational ("works well")
- Stepwise plan is committable — each step ends in a green build
- Out-of-scope section is non-empty — there is always something you're not doing
- Risks section names actual things that could break, not generic "bugs may occur"

## What "bad" looks like

- "Step 1: design, Step 2: build, Step 3: test" — vague, useless
- Tradeoffs section that only lists pros of the chosen option
- No rollback plan for changes that touch persistent state

## After writing

Show the plan to the user. Ask: "Anything you'd cut or add before we start step 1?" Wait for confirmation before implementing.
