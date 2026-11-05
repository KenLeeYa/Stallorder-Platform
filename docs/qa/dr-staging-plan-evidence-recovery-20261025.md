# Original consumed Plan evidence recovery — local wiring candidate

## Latest implementation boundary (2026-10-25)

The owner subsequently authorized implementation and independent review in the
existing owned worktree, with local verification and a report before any further
action. The owner then explicitly authorized wiring into the protected readonly
workflow and complete partial-proof, local verification and independent review.
That integration is an **uncommitted local candidate**, not remote activation.
No remote secret, upload, workflow activation, commit/push, branch synchronization,
merge, DR conversion or Primary change is authorized or performed by this step.
The design-only and standalone implementation records below are retained as
history. The latest wiring
section supersedes their former "not wired" status, not their safety limits.

## Authority and status

2026-10-25: the owner authorized minimal design and local validation of original
Plan evidence recovery, preserving the original ZIP hash, run identity and all
safety checks. Report before further action. No upload, dispatch, old Plan rerun
or reactivation, DR conversion, Primary change, commit/push, merge or branch sync
was performed. This document does not authorize those actions.

Baseline: owned `dr-staging-transition-20261022/Stallorder-Platform`, branch
`codex/conversion-source-checks-20261023`, HEAD
`86f57449e8b9cc3ec61bd95342efa81ec3b66d7d`. Protected readers, approval validators,
workflows, application code and backup-bound inputs remain unchanged. The only
tracked changes in this evaluation are this proposal and its change-ledger row.

## Evidence and the two independent blockers

- Original Plan run `39944190461`, attempt 1, source
  `32e9de2cf325240679c1a56f336b4c0f8c9d6664`, repository
  `KenLeeYa/Stallorder-Platform` (ID `1298874780`), main,
  `.github/workflows/dr-staging-conversion.yml`, owner actor/triggering actor,
  `workflow_dispatch`, completed/success were freshly read through authenticated
  GitHub GET. Failed Apply `39944614570` retains the same provenance but terminal
  failure. Source workflow blob is `8ac60fa61c3735e1486cb0df8178016d63d53346`.
- Earlier 09:15Z GET of original Plan artifact `12497002610` returned 404, and
  the original run's artifact list was empty. No repeated request was needed in
  this local evaluation. Retention-days=1 is consistent with expiration, but
  the 404 alone does not prove why it disappeared.
- The retained raw ZIP is still exactly **2508 bytes**, SHA-256
  `252c10206aff140cf3d27cb0d1a4139929d7efc5c87f44b4230ffdc7341977e7`.
  This is the original binary, not a repack of extracted JSON. Failed-Apply ZIP
  is 20984 bytes, SHA-256
  `6e453c336b9437d2e74bb9e14cc2c38029ebf2364617eb8dbacc3406c367e304`.
  Its live artifact metadata still matches the fixed pin and is unexpired.
- Actual original approval expires at **2026-10-24T11:10:55.482Z**. The unchanged
  validator rejects it now with `PLAN_EXPIRED`; the composed historical proof
  validator returns `STAGING_PARTIAL_APPROVAL_INVALID`. Restoring transport alone
  therefore cannot make the current protected reader succeed.

The current reader requires live original artifact metadata, raw bytes and
current expiry, as well as immutable approval validation. Do not synthesize
metadata, mark an expired artifact fresh, change its original ID, extend the TTL,
backdate a production invocation or bypass these checks. All stay in force.

## Smallest proposed recovery path, not wired or approved for execution

1. **Transport only the pinned original binary.** For a future separately
   reviewed protected diagnostic, prefer a narrowly named production-environment
   secret carrying the original ZIP as base64, consumed only by the proof step.
   This avoids creating a replacement artifact or a new public download surface.
   Provisioning that transport is a future remote write requiring authorization;
   no secret has been created/read/changed here. Do not place the ZIP, extracted
   Plan/provider state or base64 in Git, workflow inputs, logs or public receipts.
   Bound encoded length, require canonical decoding, then exact 2508-byte length
   and fixed SHA-256 **before** any member parsing. No caller-selected path, URL,
   artifact ID or checksum. No automatic fallback when a download fails.
2. **Use a distinct consumed-history contract.** A reviewed explicit historical
   mode would identify transport separately from original artifact/run identity.
   Freshly authenticate both original runs and source workflow; independently
   fetch and authenticate the still-available failed-Apply/backup archives. Bind
   Plan and approval digests, original source/tree/target/backup, the exact ordered
   six-checkpoint prefix and 42-file retirement receipts. A recovered copy is not
   proof that the original GitHub artifact is currently available. If the live
   run, fixed source pin or any independent binding is missing/drifts, stop.
3. **Do not reuse the current-approval result.** Any future historical validation
   must separately prove that the original failed Apply was inside the original
   approval window using authenticated run/job/checkpoint evidence. It must not
   accept a caller-controlled historical clock. Preserve and expose the fact that
   the Plan is expired and consumed now. This requires review of a new, strictly
   historical contract; it is NOT a proposed relaxation of the current Plan/Apply
   validator or permission to make the existing reader accept absent metadata.
   Until that contract is reviewed, the existing protected reader remains blocked.
4. **Return no execution capability.** Recovery may eventually establish only
   original-byte identity and consumed-history consistency. Public output must
   remain allowlisted: `diagnosticOnly=true`, `planQualified=false`,
   `applyAuthorized=false`, `remainingDataProven=false`, `remoteWrites=false`.
   Do not return recovered Plan objects as current approval inputs. No reset,
   seed, helper activation, old-run replay or provider write belongs here.

Default current-artifact transport/expiry guards remain unchanged. All later
source gates, original encrypted backup restore, exact partial-data equivalence,
current Auth/Edge/entry/Cloudflare absence, fresh credentials, Primary health and
single-writer checks remain mandatory. Full qualification still requires a new
immutable continuation Plan and its exact confirmation; historical recovery
cannot produce that Plan or authorize Apply. ADR-006 remains the architecture.

## Local validation receipt

The ignored directory `artifacts/dr-staging-plan-recovery-20261025` contains
`metadata.json` (selected authenticated GET fields, captured 09:45:39Z) and
`local-validation.probe.mjs` (originally named `local-validation.test.mjs`). The test is offline and is not imported by any
workflow. It hashes both actual retained ZIPs, reads only four bounded original
JSON members via an isolated stdin parser, and exercises existing validators.
No extracted private JSON is printed or saved. Its metadata snapshot is not a
live protected attestation. No synthetic Plan or approval was created.

Commands run in the owned worktree:

```powershell
node --test --test-reporter=spec artifacts/dr-staging-plan-recovery-20261025/local-validation.probe.mjs
npm test -- scripts/staging-partial-retirement-proof.test.mjs scripts/lib/production-approval.test.mjs
```

| Case | Result and limit |
| --- | --- |
| Original raw bytes and bounded parsing | Both pins match; four original members readable. Not original-backup decryption. |
| Tampered, truncated, appended bytes | Six cases rejected before parsing. |
| Historical inner-validator consistency | Pass at authenticated failed-Apply `updated_at` 2026-10-23T11:16:43Z, with all non-authority flags preserved. This explicit offline historical clock tests consistency only; it is not current protected provenance or proof of exact checkpoint timing. |
| Current approval and missing original artifact | Both fail closed as required, despite exact retained bytes. No fake Plan artifact metadata supplied. |
| Original run identities | Eleven drift mutations for each original run rejected. |
| Receipt/source/backup/target/prefix/storage | Twelve tamper/drift cases rejected. |
| Focused totals | 13 local probe tests passed; 26 existing provenance/approval tests passed. Vite emitted its existing native-config compatibility warning; not a product failure. |

No production implementation was changed, so no fix RED/GREEN, full app build,
full unit suite, SQL, paired Preview, ordinary Chrome or hosted proof is claimed
for this design-only change. No appserver, Docker, DB or other service was started
or stopped. No original backup key was sought or decrypted. No order was created.
Primary was not contacted or changed during this local evaluation; prior health
receipts must not be relabeled as fresh health verification.

## Historical design report boundary

**Design/local validation complete; protected evidence recovery NOT implemented
or executed; DR-to-Staging conversion NOT qualified or accepted.** The prior
PR389 ordinary-browser failure and the new candidate's unrun ordinary Chrome QA
remain separate from this result. Next human decision is whether to authorize
implementation and independent review of the narrowly scoped historical
transport/verification contract, not a rerun or renewal of the consumed Plan.

## Earlier standalone implementation candidate (historical)

`scripts/staging-plan-history.mjs` provides a separate
`readProtectedPlanHistory({ mode: "consumed-plan-history-v1" })` adapter. It has
no CLI or workflow caller. There is no default or automatic fallback and no
change to Plan/Apply's current-time approval validator. The existing partial-proof
workflow remains unchanged and still rejects the absent original Plan artifact.
Wiring the new adapter into that larger proof is **not** part of this candidate.

- Reuses the existing protected owner/main/manual/latest-source invocation guard
  and authenticated bounded GET/signed-archive transport, including a final live
  invocation readback. The protected environment/concurrency remain properties of
  the existing workflow; this library does not create a new execution channel.
- Reads only `DR_STAGING_CONSUMED_PLAN_39944190461_ZIP_BASE64` in that prospective
  protected process. Canonical base64 must decode to exactly 2508 bytes with the
  fixed original SHA-256 before any member parser runs. No caller-selected file,
  URL, artifact ID, hash, private document or historical clock is accepted by the
  protected adapter. That environment secret has **not** been provisioned.
- Fetches the two original runs, fixed Apply job `120384090004`, and the original
  source workflow at source `32e9de2c…`; validates both the GitHub blob metadata
  and the actual Git blob hash of its bytes. Original run identities are checked
  before archive-member parsing. Failed-Apply and original encrypted-backup ZIPs
  are independently downloaded with their fixed pins and current artifact expiry.
- Bounds the entire original failed Apply run/job and its successful Plan-binding
  step plus failed Apply step inside the unchanged original approval interval.
  The historical evaluation instant comes only from the authenticated failed
  step's end. This encloses the six-checkpoint receipt; it is not a claim of
  individually timestamped checkpoints. The original receipt is still expired
  at the real current clock and consumed. All original source/tree/target/backup,
  digest, ordered-prefix and 42-file Storage checks are reused unchanged.
- Returns only enumerated historical facts. `planQualified`, `applyAuthorized`,
  `remainingDataProven`, `remainingSchemaProven`, `remoteWrites`,
  `originalArtifactAvailabilityClaimed` and `backupDecrypted` remain false.
  No recovered Plan/approval/private provider state is returned. Errors use one
  fixed code without raw API bodies, URLs, JSON, child output or credentials.

Three existing modules only expose/split the reusable invocation/transport,
original archive identity and pinned-member parsing boundaries. Their existing
callers still enforce the original metadata/current-expiry checks. No migrations,
seed, reset helper, application, dependency or workflow changes are included.

### Local evidence and independent review

- TDD: after adding the module's rejecting entry stubs, the legitimate historical
  policy case was RED (1 failed / 7 passed); the implemented policy and negative
  cases then passed. An earlier missing-module collection error is setup evidence,
  not the behavioral RED.
- Focused regression: 5 files / 59 tests passed, covering history policy and the
  existing proof, original-backup, protected entry and approval contracts.
- Native full-adapter probe: **29/29 passed**, using all three actual retained ZIPs
  and original Git workflow bytes. Every HTTP response and invocation context is
  an explicit offline fixture. This is real parser/reader execution, **not** a
  live protected run or fresh authenticated provider attestation.
- Probe negatives include canonical/byte/hash drift; original run/job drift;
  missing/expired independent evidence; shape-valid same-size workflow byte drift;
  HTTP 302/401/403/404/429/500; credential-free signed redirects; explicit absence
  of an attacker second hop; final invocation drift; and unchanged current-reader
  refusal of absent original Plan metadata.
- Two independent read-only reviewers examined security/provenance and
  specification/tests separately. Both found no unresolved actionable defect.
  Their requested shape-valid workflow mutation and explicit no-attacker-hop
  assertion were added and passed. One reviewer independently ran the earlier
  27-case probe; the final 29-case run was performed by the implementing agent.
- Review-locked reader SHA-256:
  `4a7273c38c434788a561d636b7682a39637975f492b1c1d0b5a38631af17f3cb`.
  This is working-tree review, not Matt's committed-diff workflow; no commit was
  created to satisfy that workflow's incompatible prerequisite.
- Final full Vitest run: **584 files passed / 2 skipped; 3593 tests passed /
  9 skipped**, exit 0, 135.09 seconds. Typecheck, scoped ESLint (zero findings),
  diff check and static production guardrails (2366 files / 146 migrations)
  passed. Existing Vite native-config and reviewed migration warnings remain.
  No app build, SQL, ordinary Chrome, paired run or protected execution was run:
  this change affects evidence-reader libraries only, not an application/runtime
  or database. These omitted gates remain mandatory for any later release.

Run the original-byte integration locally only:

```powershell
node --test --test-reporter=spec artifacts/dr-staging-plan-recovery-20261025/reader-integration.probe.mjs
```

Both ignored native probes were renamed from `.test.mjs` to `.probe.mjs`, with
byte hashes unchanged, after Vitest attempted to collect them as empty suites.
The original archives and historical receipts are preserved. No product test or
Vitest configuration was disabled or excluded. Private original binaries are
deliberately not committed as CI fixtures; tracked tests cover synthetic policy
and refusal boundaries, while this local probe supplies original-byte coverage.

### Standalone report's remaining gates (historical)

Local implementation/review is not protected recovery activation. Separate
authorization and reviewed wiring are still needed before any secret provisioning
or protected invocation. The full original-backup decrypt/restore, partial-state
live equivalence, current source/entry/Auth/Edge/provider/Primary checks and a new
immutable continuation Plan with exact confirmation all remain outstanding.
No existing Plan is renewed or reusable. The new PR389 ordinary Chrome QA also
remains NOT_RUN; prior failure is not erased. Persistent Staging is not accepted.

No appserver, Docker, DB or existing service was started/stopped. No order, provider
write or Primary contact occurred during this implementation. Read-only GitHub
job/backup metadata retrieval is separate from the offline integration result.

## Protected workflow and complete partial-proof wiring (2026-10-25)

The workflow now declares an explicit choice, default `current-artifact`, with
`consumed-plan-history-v1` as the only historical mode. Unknown/empty modes fail
closed before network. No download error changes modes. The original Plan
artifact/current-expiry path remains unchanged and blocked; current Plan/Apply
approval validation has not changed and the consumed Plan is never renewed.

- Only the proof step receives the narrowly named original ZIP secret, and only
  when historical mode is explicitly selected. The workflow input contains a
  mode string, never ZIP bytes, URLs, hashes or private JSON. No secret has been
  provisioned. Owner/main/manual/attempt-1, production environment, read-only
  permissions, single-writer concurrency and public-only upload remain intact.
- Shared GET/invocation transport was moved without changed predicates into
  `staging-partial-retirement-transport.mjs` to avoid an import cycle. Historical
  policy now belongs to the immutable proof reader; the historical adapter keeps
  its prior public summary API and adds a PRIVATE raw-bundle API solely for the
  full composition. Raw bundles never appear in receipts or logs.
- Both entry reads and the original-backup comparison receive the same raw
  retirement bundle. Each consumer revalidates actual original Plan/Apply ZIPs,
  original runs, fixed job and actual original workflow bytes. Supplied summary
  booleans, extracted Plans, fabricated Plan metadata and caller clocks cannot
  substitute for these checks. Exact six-prefix/42-file/source/tree/target/
  approval-window checks remain. The backup consumer also rechecks against the
  decrypted original manifest's file count before handing plaintext to restore.
- Apply and encrypted-backup expiry always use the real current clock in
  historical mode, not the historical approval clock. Both own and inherited
  caller `now` fields are rejected. The original-backup raw identity and history
  are checked before backup parsing/decryption; this does not change current
  mode's historical test seam or its original validation predicates.
- Backup-bound Git comparison, current sources, entry/Primary, Auth/Edge/
  isolation/global observations, original restore/replay and single-statement
  comparison, final observations and final invocation readback all remain.
  Public output explicitly enumerates history facts and keeps all qualification
  flags false; historical-only `backupDecrypted=false` is not misreported after
  the full comparison. Exact owned-container cleanup is unchanged.

### Wiring validation and review

Initial behavioral RED: 2 failed / 15 passed in the readonly suite because the
mode guard and workflow input did not yet exist. Subsequent targeted tests passed.
The integration tests use explicit adapters and in-memory responses; no runtime
invocation context was altered to execute the real protected CLI.

Independent safety review found a direct-consumer backup-clock seam. It was fixed
by rejecting own/inherited clocks before archive parsing/decryption. A deliberate
guard-deletion mutation made the new tracked regression fail (1 failed, 9 other
tests deselected); the guard was immediately restored. These are scoped mutation
selection counts, not waived or newly skipped product tests.

Final suite counts, review conclusions and source hashes are recorded in the
ignored `artifacts/dr-staging-plan-recovery-20261025/wiring-verification.md` receipt.
Final full unit: 585 files passed / 2 skipped; 3612 tests passed / 9 skipped,
exit 0 (134.20s). Focused suite: 16 files / 151 passed; composition 17 passed.
Expanded native original-byte probe: 45 passed, zero skips/failures, with all
network/invocation context still explicit fixtures and no original backup key.
Typecheck, scoped ESLint (zero findings), diff check and static production
guardrails (2368 files / 146 migrations) passed. Existing Vite native-config,
reviewed-migration and Git LF/CRLF warnings were retained, not suppressed.
Two independent read-only reviewers found zero unresolved actionable findings
after the clock fix. They reviewed source/diffs/tests, not independent execution
or live protected attestation. The QA skill's local-versus-live distinction is
preserved; Matt's committed-diff prerequisite was not bypassed with a commit.
Original-byte probe failures caused by an initially too-narrow expected fixed
error-code list were corrected to the actual fail-closed codes; no product guard
was relaxed. PowerShell did not expand a CLI wildcard in one early focused run;
the complete file list was then supplied explicitly. Neither is a product pass
or a hidden product failure.

### Current report and authorization boundary

This is local wiring, not protected execution or a release. No remote secret,
upload, commit/push, sync/merge, workflow trigger, order, provider/DR/Primary
operation, service start/stop, backup-key lookup or original backup decryption
occurred in this wiring step. Primary was not contacted; old health evidence is
not fresh. All actual workflow GitHub/provider responses in local integration
tests are fixtures. Actual original-archive byte parsing is separate evidence.

Protected invocation, original decrypt/restore and live partial-state comparison,
current CF absence/Auth/Edge/provider/source/Primary checks, real human/runtime
acceptance and a new immutable continuation Plan with exact confirmation remain
outstanding. Candidate ordinary Chrome QA is still NOT_RUN and the original
FAILED result is preserved. Persistent Staging is not accepted. Await explicit
human authorization before publication, secret provisioning or remote execution;
none of these follow automatically from local success.
