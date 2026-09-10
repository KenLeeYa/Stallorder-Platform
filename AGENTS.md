# AGENTS.md instructions

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## StallOrder change memory

For every owner-approved architecture or product-function change in this repository:

- Read `docs/ARCHITECTURE_AND_FEATURE_CHANGELOG.md` and the affected domain documentation before editing.
- Update the relevant Markdown architecture, ADR, runbook, requirement, or operating document in the same change as the code.
- Append one entry to `docs/ARCHITECTURE_AND_FEATURE_CHANGELOG.md` with status, affected surfaces, verification, and release evidence. Use `Proposed` for an evaluation that has not been applied.
- Update the `stallorder-product-qa` Skill only when the change creates or supersedes a durable acceptance rule, architecture invariant, regression dependency, or release gate. Keep detailed design in repository Markdown and keep the Skill as routing plus non-obvious invariants.
- Do not treat documentation, a Skill entry, a prior chat, or an old Plan/Apply receipt as authorization for a remote mutation.

Before release, verify that code, executable tests, repository documentation, the change ledger, and applicable Skill rules describe the same behavior. A release with missing or contradictory change memory is incomplete.

## Local test service lifecycle

- Start only the Docker/Supabase project and development processes needed for the current test. Verify project labels, ports, worktree and active consumers first; never infer ownership from the current directory alone.
- After testing, stop services started for that test by default. Keep them running only for an active dependent task or an explicit owner request to retain a manual QA environment; record that exception and its ports.
- Stop exact project containers without deleting containers, images, volumes or test data. Never use prune, reset, volume deletion, or a machine-wide Docker stop while another task still depends on it.
- Record what remains running, what stopped, and how to resume. A stopped Engine is not proof that unwanted containers will remain stopped after Engine startup; reconcile the running allowlist after starting Docker Desktop.
- See `docs/LOCAL_TEST_SERVICE_LIFECYCLE.md` for the current service inventory and safe stop/start procedure.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" -> "Write tests for invalid inputs, then make them pass"
- "Fix the bug" -> "Write a test that reproduces it, then make it pass"
- "Refactor X" -> "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
