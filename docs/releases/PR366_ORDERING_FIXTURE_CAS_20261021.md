# PR366 ordering fixture lifetime repair

Status: local implementation; no new hosted resources or Production writes.

## Observed failure and evidence limits

Candidate `ea38e8094f017d4345d02c75de031a1847acc723` passed full CI [39456477602](https://github.com/KenLeeYa/Stallorder-Platform/actions/runs/39456477602).
Hosted validation [39462375155](https://github.com/KenLeeYa/Stallorder-Platform/actions/runs/39462375155) failed at `restoreOrdering` with `FIXTURE_ORDERING_CONCURRENT_CHANGE` after main browser cases, four hours scenarios and 18 midnight DB assertions passed. Preorder and subsequent smoke did not run. This is not full acceptance.

The saved ordering receipt has millisecond versions, before `2026-10-20T17:04:49.351Z` and after `2026-10-20T17:24:41.095Z`. The final live row was not captured before cleanup; a real external race is not proven. Final receipt artifact `12284808947` reports `CLEANED`; parent independently read back absence of child `sdjjfjpvxfhcssoijpkw` and Preview `dpl_Bt9iBeTZobXCz7KnH5kJmEfF58Wa`. The existing [deadline watcher](https://github.com/KenLeeYa/Stallorder-Platform/actions/runs/39462576114) is retained; no duplicate execution is needed.

## Reproduced sequencing defect

`stall_ordering_settings.updated_at` is `TIMESTAMP(3)` in the base migration and Prisma has `@updatedAt`. The merchant product PATCH transaction updates `checkoutUpsellProductIds` on that same row, including unchanged arrays. Catalog save/restore occurs after the old workflow's ordering snapshot. A real Prisma update advances the version even with unchanged five fixture flags. The subsequent strict restore correctly refuses that stale snapshot.

Move `prepare-ordering` and `pos-descriptor` into the supervised main UI, after catalog and other preparation cases, immediately before POS. Keep the POS product and cash-shift preparation before main UI. Both initial validation and resume explicitly enable this action, then persist the generated POS descriptor into the binding after successful main UI so later hours/preorder processes retain it. `runDatabaseFixture` retains its exact provider/child/receipt guards and journals the same fixture evidence. A failed preparation propagates; the descriptor is not read after failure. No additional browser case is counted as passed by this change.

The restore predicate remains unchanged: exact scope, saved version and all five expected flags. Never refresh the snapshot at restore time, ignore a zero-row update, or claim a concurrent write has been safely overwritten.

## Local verification contract

The opt-in real PostgreSQL test in `scripts/qa-pr366-preview-db-fixtures.test.mjs` accepts only loopback and database name `pr366_ordering_cas`. It uses actual generated Prisma delegates and real SQL for the ordering and hours tables. Only seed-parent identity lookups are stubbed; this is a focused database integration test, not full application/migration acceptance.

Run against an explicitly owned disposable PostgreSQL 17 database:

```powershell
$env:PR366_ORDERING_CAS_TEST_DATABASE_URL = '<loopback URL ending /pr366_ordering_cas>'
npx vitest run scripts/qa-pr366-preview-db-fixtures.test.mjs scripts/qa-pr366-preview-ui.test.mjs scripts/ephemeral-preview-qa-contract.test.mjs
```

Checks cover unchanged-row Date/JSON roundtrip; a timestamp(6) precision contrast; unchanged catalog upsell writes invalidating an earlier snapshot; reordered catalog then snapshot plus actual hours fixture/restore; timestamp-only, unrelated array and every fixture-flag change rejecting restore; flag changes retaining the old timestamp; and wrong run/child/stall/organization evidence rejection. This test is explicitly skipped unless its disposable database URL is supplied.

Local service is exact container `stallorder-pr366-ordering-cas-20261021`, pinned cached PostgreSQL 17 image, loopback port 56959, synthetic data on tmpfs. Docker Engine was already running. Stop only this container after verification; preserve the unrelated `line-booking-test-20261004` container and Engine. No pull, reset, prune or persistent volume deletion.

Final focused verification: **121 passed**, including the real PostgreSQL test with `uuid[]` and actual Prisma `update` matching the catalog write. Typecheck and focused ESLint passed. Independent read-only review found no remaining lifetime, descriptor propagation, CAS or evidence/cleanup blocker after its uuid-array schema observation was corrected. Full local unit regression is separately recorded; its initial sandbox attempt failed during temporary-file rename with EPERM before tests loaded and is not acceptance evidence.

Full local unit run outside that sandbox: **4791 passed / 108 skipped**, with **8 Mobile suite load failures** because this selected Web installation has no `expo/tsconfig.base` (716 files passed, 13 skipped). Overall result remains NON_PASS; no executed assertion failed. This does not justify expanding the Web release repair into a Native toolchain install. The final focused 121-test run followed the descriptor persistence and uuid-array fixes. PostgreSQL reports 17.10; information_schema confirms ordering timestamp precision 3 and upsell `_uuid` array. Raw local logs are retained in the parent task directory as `phase8-related-final.log`, `phase8-full-unit-elevated.log`, `phase8-typecheck.log` and `phase8-lint.log`. Fresh exact-source CI remains required.

## Remaining release gates

Local regression and new free CI do not replace full exact-candidate hosted acceptance. A new paid pair requires a new scoped cost approval. Keep the existing vulnerability exception expiry `2026-10-22T14:00:00Z`; the original raw audit remains NON_PASS/NOT_FIXED. Preserve DR replication, backup/restore verification, strict branch/evidence gates, the correct DB/Edge Plan/Apply route and rollback prerequisites. Formal aliases remain on previously observed `5cc15c6a`; this repair does not authorize or perform a switch.
