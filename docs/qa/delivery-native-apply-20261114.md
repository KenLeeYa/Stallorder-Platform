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
rollback, interruption rollback, successful apply and duplicate-apply refusal.
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
