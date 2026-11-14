# Delivery native transaction rehearsal

Status: candidate; not installed as a Production executor.

PR398 was merged at `2026-11-14T02:09:42Z`, producing protected main
`be018da48c9a83f21e1e79c2834cda96eee69a1e`. The rehearsal preparation branch was based on
`3fe9452d42caecd6271408ab0a236a645cc4978c`, preserving its existing free,
public-runner qualification and recovery workflows. Vercel Git deployment for
`codex/primary-only-preparation` remains disabled. The product is unchanged:
`0d2b27144fcf589bb887e669c09e82158e3de7a2`.

The new pure `applySql` builder executes the pinned migration bytes inside one
transaction. Before mutation it locks migration history and compares the full
authenticated baseline: actual database principal, four function definitions,
owners, ACLs, configuration, OIDs, absent helper, and all 146 migration records.
It inserts the exact separately qualified migration record and checks the whole
postimage before commit. Only the new helper's database-assigned OID is excluded
from cross-execution equality; its definition and permissions remain exact.

The owned PostgreSQL rehearsal first derives the postimage by applying the
frozen product through the existing Supabase migration tool. It restores the
baseline, then exercises native stale-preimage rejection, wrong-postimage
rollback, SQL-error rollback, successful apply and duplicate-apply refusal.
The existing order preservation, replay, dependency refusal and final cleanup
checks still run. No Production credential or provider mutation is used.

This builder does not authenticate supplied snapshots, open a connection,
retry, authorize release or modify the installed read-only collector. A future
protected caller must bind both snapshots to authenticated evidence, verify
the actual Primary endpoint and password identity, settle unknown outcomes,
and retain explicit recovery. Actual Primary capture, Edge archive/recovery,
old-App compatibility and the combined DB/Edge/App workflow remain required.
Local tests alone do not satisfy those gates.

The owner updated `production/SUPABASE_DB_PASSWORD`; GitHub metadata confirms
`updated_at=2026-11-14T02:21:03Z`. No secret value was accessed. The previous
six-hour qualification has expired, so a new genuine exact-product run and
complete source-security review must precede the next protected capture.

The candidate workflow also runs the new native transaction builder regression
before reconstructing its frozen product. Existing source reconstruction and
all product acceptance assertions are unchanged.

## Actual rehearsal and independent review

Run43546722437/job132299666033 completed successfully on control
7786e8368a8a81b36fee925e8ae1b561b8d15f01 with PostgreSQL17.6. The raw log SHA256
is 0e6efd83890cd5990b73ff427e6b2929771e40a9a309cac24702f78bb0ac3236.
All native Apply/refusal/recovery cases and order preservation/replay passed;
owned orders and sessions were zero after cleanup. Independent source review
found no Critical or Important issue; its receipt SHA256 is
b6ed902022d58dbe737132fe7c07a6c5d161078c9e786d0633d387eb9703a3c8.

The SQL-abort case uses SELECT 1/0 before COMMIT. It proves transaction rollback
on a server SQL error, not connection-loss or unknown-commit settlement. Those
remain required for the protected remote caller. The caller must enforce one
coordinated writer and exclude other direct function/role DDL throughout the
operation. The migration-history lock is not a lock on every function or role.

A 2026-11-14T02:42:53Z read-only Primary observation found delivery enabled for
the affected store; this supersedes the old paused-state assumption. This task
has not changed that setting. Production remains revision4e95d2 with146
migrations. No Primary migration, Edge deployment or App release is claimed.

## Proposed connection-loss settlement extension

The new classifier accepts only a complete current baseline or qualified postimage (with the target-assigned helper OID), and otherwise returns unknown. Every result forbids an automatic retry. A future protected caller must authenticate each fresh read and settle the existing operation before any later Edge/App write.

The hosted candidate now disconnects its own loopback PostgreSQL session at an exact pg_sleep before COMMIT and after COMMIT, distinguished by a fixed run-ID/phase application name, current database and current user. It verifies not-applied and applied readbacks respectively, then explicitly restores its synthetic baseline. Local29 tests and lint pass; independent follow-up review and actual hosted results are pending. No Primary connection, live settlement or release is claimed.

A baseline read alone cannot prove a disconnected writer will not later commit. Before treating either observation as settled, the protected caller must establish that the original writer/backend is quiescent or fence and resolve it. The owned rehearsal terminates the exact sleeping backend and awaits its client exit before reading state; it does not prove this property for a hosted pooler connection.

## Completed connection-loss and qualification evidence

Run43549144514/job132307312119 completed successfully at control ca570f44de90dfcacf59f3f034c633d5827da932. PostgreSQL17.6 proved both actual owned-session disconnect cases: before COMMIT yielded not-applied, after COMMIT yielded applied, and both prohibited automatic retry. Recovery and final owned order/session cleanup passed. The raw log SHA256 is af9e60045e91f0bdfa9f4b26580f44b16f71f95bdf212a6e4880ebe3c1f25992; independent hosted-review receipt SHA256 is 4c21118d54e6e919314f96270dd780cc21dcd312b95443832da16f18ddb92f8f. This resolves the earlier pending synthetic follow-up only; Primary and hosted-pooler settlement remain unverified.

Run19 (43546722491) verification job132299666438 passed all exact frozen-product functional checks and full browser regressions. The unchanged raw security job failed with 14 findings; all 14 were independently reviewed as false positives against the entire scan and exact source. The adjudicator now accounts for the native Actions expected-extraction diagnostic as required coverage, preserving rejection of missing extraction, unknown notifications and warnings. Local security tests passed8/8, and the bounded evidence suite passed100/100. Actual hosted admission remains a separate gate. Run19 expires at2026-11-14T08:30:52Z, six hours after original creation; no evidence timestamp was extended. Production is unchanged.

## Completed hosted admission and installation boundary

Actual hosted admission43550093585/job132310339629 succeeded on5bef38e1c5b6248d40282f1d9497f49d2666c2ca. It reconstructed the exact clean product, passed99 control tests, authenticated both complete logs, and re-read provider execution metadata after collection. Its receipt is evidenceVerified=true and releaseAuthorized=false, with qualification SHA25607d7530f4e09b221abbf6cc064c5806b3a0f195e31198fc438ff3837f3e20d48. The raw admission log SHA256 is80e212d3017091e02822d5ba86de9f26920f396f0914dad4a4e07daecbea204c. The original security failure remains recorded, and original Run19 expiry remains2026-11-14T08:30:52Z.

This main-based installation candidate retains owner-only manual capture, protected main/staging tree equality, shared production writer serialization, exact product and existing executor contract. Its native transaction builder is not wired to a remote mutating executor. The owner reported included-credit usage of USD10.83/USD20, interpreted as approximately USD9.17 remaining. Promotion uses the existing conversion branch and paired Preview resources, without creating provider resources or changing billing limits. Preview source admission still requires the exact new installation PR number before provider writes; actual required Preview checks must pass before merge. The source installation is still required before using the updated password in the protected read-only Primary collector.

PR399 initial CI43550971106 failed three credential-handoff tests because their synthetic event still named superseded PR397. Update that fixture to399 while retaining the actual restrictive invocation guard. The complete control suite then passed965/965 with zero skips. Local Windows checkout had converted the immutable commit.txt bundle toCRLF; restoring the existing committed LF bytes, without changing the Git object or digest, was required for that byte-bound source check. No acceptance rule or expected digest was relaxed. The obsolete Preview run was cancelled through normal GitHub cancellation so its always-cleanup can complete before the new head uses the same serialized resource.

## No-additional-spend Preview scope

Read-only Vercel environment metadata (without decryption) showed four inherited global Azure translation variables applicable to Preview. The existing optional glossary smoke would therefore invoke an external translation provider unrelated to the frozen delivery change. To follow the owner's no-additional-cost constraint, keep that optional smoke disabled even when inherited configuration is complete. Preserve configuration consistency checks, actual isolated DB/Edge/public-order/OAuth checks and owned cleanup. The new paired Preview deployment explicitly sets CATALOG_TRANSLATION_ENABLED=false at both build and runtime. Global/project provider variables and Production runtime settings are not changed.

Replace the optional14-day artifact upload with two bounded, fixed-path JSON QA summaries and their hashes in the existing run log. Those reports contain source/backend/origin, principal diagnostics and acceptance booleans; they contain no session token, credential or customer rows. Screenshots remain temporary runner output, so this is not a retained screenshot review. The31 existing production workflow-contract tests and YAML parsing passed. Obsolete Preview43551503728 was normally cancelled while running isolated database tests; its fixture cleanup succeeded before the corrected execution. No Azure translation request from that run is claimed.
