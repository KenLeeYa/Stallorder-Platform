# Delivery native transaction rehearsal

Status: candidate; not installed as a Production executor.

PR398 was merged at `2026-11-14T02:09:42Z`, producing protected main
`be018da48c9a83f21e1e79c2834cda96eee69a1e`. This preparation branch is based on
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
