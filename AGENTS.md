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

## Production availability after the 2026-09-12 DR incident

- User-confirmed context as of 2026-09-12: StallOrder has not publicly launched; three merchants are testing, and this incident occurred outside system-use hours. This context does not relax Production availability or release checks.
- Before changes to application features, authentication, environment variables, deployment, domains, Access, database or DR, map affected login/order paths and capture the healthy Production baseline: actual project, deployment, aliases, backend target, commit and health. Verify a compatible recovery target before writing remotely.
- Keep Primary and DR project bindings explicit, including child-process environment variables. Read provider state back; `.vercel/project.json`, a successful command or a green Plan alone is not proof of the actual target. DR-only changes must leave Primary deployment, aliases and backend unchanged.
- Use one coordinated remote writer across tasks. Check Production before changes, after each remote step that can affect it, periodically during long-running deployment work, and after completion. Include login/staff entry, health and the affected QR, pickup, delivery or staff order flows with authorized test accounts/data.
- If Production regresses or target identity differs from the plan, stop further release writes and prioritize recovery within existing authorization. Restore an explicitly verified healthy artifact; do not assume the immediately previous deployment is safe. Database writer changes require the existing failback procedure.
- Confirm recovery using provider readback and the real Production hostname, not only cleanup success. Separate passed, failed and skipped checks; missing authenticated/valid-QR tests must not be counted as passed or described as full flow verification. CI/Plan success is not deployment success, and recovery does not automatically resume paused DR publication.
- Record receipts and remaining verification gaps. Follow `docs/incidents/2026-09-12-dr-production-outage.md`, `docs/INCIDENT_RESPONSE.md` and `docs/PRODUCTION_ROLLBACK.md`; retain these requirements when preparing another release worktree.

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
