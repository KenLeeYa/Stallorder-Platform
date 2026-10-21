# Current bounded baseline results

2026-10-01. Exact source HEAD87230e2/treeee9337eb. The table below preserves the original Batch1 run at `.superpowers/sdd/2026-10-01-awesome-optimization/batch-1/runs/2026-10-01T01-27-41-925Z/receipt.json`, hash `03d6f5bbba76c4ae938e4b4ecbe31d21dc7136dbbc510a71bf3c606c9a638dee`. Independent review found missing effective identity inputs and three other tooling defects; that historical run does not attest the repaired current source. Fresh repair receipt, effective-input inventory, raw commands and hashes are recorded in `batch-1-repair/` and `batch-1-repair-report.md`. The identity excludes `.env` files/values and remains bounded QA evidence, not an immutable Production build/release attestation.

| Original Batch1 command / seam | Actual outcome | Evidence / limit |
| --- | --- | --- |
| node --version / npm --version | v24.18.0 /11.16.0, exit0 | Fresh read; current manifest/lock in inventory.json |
| Real wrong-target Admin/Merchant module imports | RED6failed constructor assertions; GREEN6 plus6existing guard cases PASS | guard-red.log / guard-green.log; fake DB/Playwright boundaries, zero wrong-target connection/request; not browser flows |
| Required check failure/missing/not_run/timeout and split-output redaction | PASS via public runner / child-process seam | runner-final.log and final foundation receipt; actual failed command exit7/missing ENOENT/timeout/NOT_RUN remain nonzero |
| Final foundation tests | 7files/56PASS, exit0 | `.superpowers/sdd/2026-10-01-awesome-optimization/batch-1/runs/2026-10-01T01-27-41-925Z/receipt.json` / foundation-tests.log; includes preserved32Production workflow contracts and6target guards |
| Existing read/live/application authority tests | 3files/19PASS, exit0 | affected-authority-tests.log; use-live-resource, report-data, application-state; not entire application suite |
| Typecheck | PASS, exit0 | typecheck.log; node node_modules/typescript/bin/tsc --noEmit |
| Scoped lint | PASS, exit0 | affected-lint.log; exact tooling and two lab specs |
| Browser/native/shared source boundaries | No new/different findings; existing exact hashed static debt retained | client-boundaries.log; not universal bundle/runtime security PASS |
| external-check | local-mock, disabled pending approval; PRESENT/MISSING only, exit0 | external-disabled.log; synthetic explicit live mode negative exits1; no provider call |
| Default optimize:verify | exit1;6executed checks PASS,4required NOT_RUN | verify-final.log; preserves INCOMPLETE; no full-product green |
| optimize:report --receipt=... | exit1/incomplete; matchingSource=true/logsMatch=true | report-final.json; no file-existence-only PASS |

## Fresh bounded repair results

Current receipt: `.superpowers/sdd/2026-10-01-awesome-optimization/batch-1/runs/2026-10-01T01-57-51-630Z/receipt.json`; equal execution BEFORE/AFTER SHA256 `4f5b6b1e7563ab29aa8acbd2c96ec5ee9b01ea512fe1e63a1ef8ee18f804e98b`. Inventory records 2031 effective input paths/hashes (missing configured paths represented explicitly), including the six review omissions, repository-owned scripts/helpers and workflow fixtures, nonsecret configs, lock and installed check launchers. It excludes `.env` files/values and root-owned documentation.

I1–I4 genuine API RED: 20 assertions failed after the separately retained ESM-harness failure. Focused GREEN: 3files/35PASS. Final foundation: 9files/96PASS, exit0, including portable captured receipt/raw-log test data, exact scope/recipes/status negatives, six public inventory mutations, isolated create/change/delete, real LF/CRLF baseline/substantive-change rejection, AST comment/BOM/directive and Native no-escape cases, and Preview missing/malformed/denied readback. Captured fixture metadata is regression data, not current product test evidence.

Final full verify: all six executable checks PASS, four required NOT_RUN, exit1/INCOMPLETE. Authority tests remain 3files/19PASS; typecheck/scoped lint/static boundaries/external-disabled each exit0. Fresh report returns exit1/incomplete with matchingSource=true and logsMatch=true. Raw commands/results and exact owned hashes/diff are in `batch-1-repair/` and `batch-1-repair-report.md`. Independent bounded re-review is still required. Actual Preview has no required-reviewers rule, so external activation is blocked; no remote workflow or setting change occurred. Only the two owned workflow action refs are fully SHA-pinned.

## Three representative build artifact measurements
Fresh read-only measurement of the **existing** build artifact `MsLkYO9IuvF0MChdFvoVl`, HEAD87230e2/treeee9337eb, built2026-09-30T21:35:22.980Z. This is not a fresh post-change build or browser baseline. Raw `route-artifact-baseline.json` records each referenced chunk bytes/gzip/hash and exact manifest hash. Catalog10chunks225625uncompressedbytes; order-history12chunks278118bytes; admin-review8chunks250660bytes. These are all referenced JS files, **not entry-only budget, transfer size or timing**; no estimated performance improvement. This batch changes tooling/package script entries/test guards/CI only, no application source/dependency.

## Pending BEFORE measurements and real usage
The fixed2organization/3stall/role synthetic fixture and three-page actual browser/API metric BEFORE remain NOT_RUN and must be captured by the next sole consumer writer before first product edit. Preregistered protocol/sample counts/role flows/ownership marker are in IMPLEMENTATION_PLAN. No unknown seed/reset/public assignment mutation was performed. Database tenant/RLS, core QR/Staff/KDS/onboarding/notification/job flows, all current Native compatibility/emulator/device, full root unit/build/security/audit and performance paired AFTER remain NOT_RUN in this batch. Old3630unitPASS/100SKIP and old responsive/emulator receipts are historical only.

Runtime lifecycle: no app/listener/container/provider/DB started or stopped by this batch. Root retained one7container responsive project56821/56822 for active dependent tasks; no new project, reset, prune, volume deletion or catalog55722 request. Parent controls final service closure. Production readback is root-owned; no remote workflow, DB, provider, account, secret, deployment or release writes here.
