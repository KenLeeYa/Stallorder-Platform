# ADR-006: Retire the old DR into independent Staging

- Date: 2026-10-21
- Status: Owner approved; implementation and restore qualification in progress.
- Supersedes: ADR-005 decisions 2–6 and the DR readiness/replication release gates
  only after this conversion's acceptance evidence is complete. Until then the
  existing endpoint remains fenced; do not present it as ready Staging.

## Decision and invariants

Reuse the existing DR Supabase project `daeqwtpaxcebmtwxqdkj` and Vercel project
`prj_GOSwYN5rKhSuD3d4gPJEVtmKt7b3`; do not create a billable replacement. The final
test hostname is `staging.qidaigo.com`. Retire the old `dr.qidaigo.com` entry only
after the new protected entry is verified. Production remains exclusively on
`app.qidaigo.com`, Supabase `eyuctbnlvnbnivwasvqr`, Vercel
`prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP`. There will no longer be a qualified DR failover
target; an independent test database is not a Production recovery replica.

1. Prove an encrypted backup can restore DR's table data and actual Storage file
   bytes before deleting any hosted replica. Preserve authenticated encryption,
   source/backup identity and drift checks. Archive listing/counts alone do not
   establish restoration. Preserve the backup key outside the retired runtime.
2. Retire both database replication and Primary-to-DR Storage writes. Do not stop
   Primary's ordinary expiration/deletion queue. Remove DR database/Storage runtime
   bindings, check read-routing/failover overrides, and reconcile old DR jobs before
   opening the test environment. Preserve the Primary publication as historical
   metadata unless separately reviewed; no automatic reconstruction/subscription.
3. Only after isolation and restore proof, clear DR's old business records/files
   and replace them with synthetic data using the repository's migrations and
   seed contracts. Do not copy current Primary data, OAuth identities, sessions,
   order-token secrets, API/provider credentials, queues or device registrations.
4. The test application uses a Vercel Preview runtime, independent database/Auth/
   Storage/Edge bindings and test-only secrets. Its logical PRIMARY writer label
   is local to the isolated test DB, not authority over Production. Disable real
   payment, invoice, LINE, email/push, delivery and hardware dispatch. Mock/provider
   guards must remain fail-closed in the Production runtime.
5. Keep Cloudflare Access account-member access and origin JWT issuer/audience
   validation; generated Vercel URLs retain Standard protection. No purchase of
   Advanced Deployment Protection. Reuse the existing Access implementation with
   the exact Staging host and new/current audience; do not make the origin public.
   Standard protection also covers Preview custom domains. After verifying the
   exact target Preview deployment, source and JWT configuration, use only the
   `staging.qidaigo.com` alias's `alias-protection-override`. Read it back; never
   change project-wide protection or exempt a generated/Primary hostname. Direct
   anonymous origin access must still return the application's empty403; revoke
   the exact exception and restore the proxy if that check fails. Cloudflare
   Access remains required, and generated URLs remain Standard-SSO-protected.
6. Keep the source promotion order: candidate PR → `staging` CI/isolated Preview
   and persistent Staging QA → verified tree promotion to `main` → protected
   application release. The retired DR must never be used to satisfy DR readiness
   or automatically receive Production migrations, credentials or customer data.

## Acceptance before completion

- Exact baseline, reversible configuration receipt and single remote writer.
- Verified encrypted data/file restore; effective grants/RLS and synthetic seed
  isolation. Source must remain unchanged between backup and approved cleanup.
- No subscription/slot, no active DR cron, no Primary-to-test Storage/DB routing;
  Primary cleanup still works. No obsolete automation can recreate replication.
- Staging login → authorized workspace; synthetic QR → order → Staff/KDS and
  simulated printing/payment boundaries; image upload/read/deletion; tenant denial.
- Anonymous Access denial and direct-origin protection; test runtime cannot read
  Primary secrets or send real external effects. Test data never appears on Primary.
- Provider readback, source SHA, aliases, actual backing DB and signed receipt;
  Primary login/availability/affected ordering flow unchanged after each mutation.

The detailed execution record is [DR-to-Staging QA](../qa/dr-to-staging-20261021.md).
Until every required acceptance case passes, report this conversion as incomplete.

## Primary runtime isolation prerequisite

The application-only release has an explicit `retire_dr_runtime` option. Its
immutable Plan binds the exact live Primary artifact and five Production-only DR
environment binding IDs/metadata. Apply rejects drift, shared Preview bindings,
unexpected DR keys and mismatched project/revision identities. The reviewed new
artifact overrides those five bindings to empty at build and runtime, is probed
before promotion, and passes live Production smoke before the planned bindings
are removed. Other environments and non-DR settings are retained and rechecked.
No database or Edge Function mutation belongs to this prerequisite.

This prerequisite uses the existing paired, data-less Preview qualification while
persistent Staging is still unavailable; it does not claim Staging acceptance.
The verified previous artifact remains a recovery option only while the original
DR data is intact. After cleanup, recovery must use a verified Primary-only
artifact; never restore an old artifact capable of mirroring into synthetic Staging.

## Recovery-only reference closure

The original DR contains 552 print jobs referencing three missing print rules.
Preserve its original encrypted dump without modifying either hosted database.
For archival recovery only, read exactly those three existing Primary rules with
Management API `read_only=true`, selecting only DR's existing columns and requiring
their complete printer/organization/stall tuple to exist in DR. Encrypt this
supplement separately, with source identity and capture time. Do not copy any
additional dependencies or credentials; fail if the bounded closure is incomplete.

Insert the supplement only into the disposable, offline restore database before
restoring the original post-data section. Every original constraint must still be
created and validated; do not disable triggers, remove constraints, null original
references, or replace original rows. Compare all original DR table fingerprints
separately from the three supplemental rows and verify the latter exactly. The
receipt must disclose that the original replica is not self-contained and that
the current Primary reference rows are supplemental, not historical DR rows.
These recovery artifacts are never Staging seed inputs. Staging still starts from
reviewed migrations and synthetic data only; this does not qualify DR failover.

## One-time conversion transaction

`dr-staging-conversion.yml` is owner/main-only, uses the existing remote-writer
lock, and requires successful main/staging CI, source security and database
readiness runs. Its fresh immutable Plan binds the qualified encrypted backup,
unchanged migration/seed/reset implementation, source table fingerprints,
Primary deployment/environment/DNS, and target provider prestate. Apply repeats
those checks. Failed or partially applied transactions must not be blindly rerun.
Inspect the step journal and exact provider identities, preserve the backup,
and create a source-bound recovery operation when correction is needed.

If failure occurs before provider isolation or data cleanup, recovery may remove
only the new entry resources identified by that failed run's encrypted state and
sanitized receipt. First revalidate the qualified backup, unchanged original data,
both old aliases and Primary; bind the operator record to the failed source and
immutable Plan. Remove the new Vercel domain mapping, then its exact DNS record,
then its Access application. Never remove old DR entry resources during this
recovery. Read the complete provider/Primary prestate back against the original
Plan before creating a fresh Plan; UI success alone is not recovery evidence.

If aliases were already detached but Auth/Edge and all original data still match
the qualified Plan, first restore only its two recorded DR hosts to their exact
old project/deployment/UID, retaining the old Access/DNS and generated-origin SSO.
Recheck the original no-redirect/no-branch domain configuration before removing
the failed run's new entry. Domain creation timestamps/order can change during
recreation: record that bounded difference explicitly, compare every other
provider/Primary prestate field, and require a fresh source-bound Plan. Never
claim byte-identical provider recovery or reuse the previous Plan in that case.

If Auth PATCH succeeded before its readback failed, do not restore opaque or
unverifiable archived credentials as plaintext. A bounded pre-data recovery may
retain the already-disabled providers/hooks/signup/SMTP and clear only the exact
remaining credential fields using the verified nullable contract. Bind that
operation to the failed source/Plan and current Auth digest; prove all unrelated
Auth fields, original data/files, Edge and Primary unchanged. Recover the exact
old entry identities as above without reactivating login providers. Record the
new isolated Auth digest separately from recreated domain metadata, and require
a fresh Plan to capture it. This is retained isolation, not full Auth restoration
or permission to accept arbitrary readback values, replay Apply or clear data.

Alias reads and deletions must use their own provider contracts. Retire aliases
by the Plan-bound immutable UID, rechecking the UID, retired hostname and DR
project at the actual delete boundary. Report a failed request's method, provider,
path and status without response bodies, query values or authorization headers.

Before deleting old files or resetting the database, create and verify restricted
Staging Access, prove actual Access/DNS edit permissions, and detach only the two
old public DR aliases/domain mappings. The old generated deployment remains
Standard-SSO-protected. Its source artifact is not a valid recovery target after
the database becomes synthetic. Old DR DNS/Access is removed only after actual
Staging application acceptance passes; Primary domains are never cleanup targets.

Disable old Auth providers/hooks/SMTP, rotate only target Edge credentials, clear
Vault and old private schemas, and use the qualified pinned remote reset path.
Clear nullable Auth provider credentials/client IDs and Hook URI/secret fields
with JSON `null`, not empty strings. Empty OAuth/SMS secret strings produced
nonempty opaque readback values in the actual provider; the isolation check must
continue to reject those values. Hooks validate format even when `enabled=false`.
Omit already-empty,
disabled Hooks from PATCH: configuring unused MFA/password-verification Hooks
still invokes paid-plan checks. Verify those omitted fields remain disabled/empty
in the actual readback. A configured Hook that cannot be disabled must block
conversion; never enable billing or skip the isolation requirement.
Run unchanged migrations/seed, hosted database tests/lint and the Staging-only
safety overlay. Only Preview variables are created. Deploy only a `git archive`
of the reviewed source: decrypted runner settings, Access tokens and backup inputs
must never be uploaded as application files. Use a temporary one-hour QA service
token, remove its policy/token on exit, and retain only encrypted recovery inputs.

Hosted pgTAP validation takes about 12–13 minutes in the observed paired Preview
runs. Execute every recursively discovered SQL test in ordered batches of at most
20 files, retaining the ten-minute subprocess deadline and existing workflow
budget. A missing suite or any failed batch aborts conversion; batching must not
skip files, loosen SQL assertions, or turn timeouts into success.

The historical DR workflows and direct DR project configurator are disabled for
this retired target. The former DR-schema predecessor does not qualify synthetic
Staging; Production schema publication remains fail-closed until the independent
Staging validation predecessor is in place. This is not permission to skip it.
Cloudflare human IdP login and ordinary browser/service-worker behavior remain
separate completion checks from service-token-assisted Playwright.

Ephemeral Preview must also provision independently generated public-order
secrets in both Edge and application runtimes and verify provider digests before
functional QA. OAuth/delivery smoke alone did not detect a missing Edge secret.
Require a real hosted QR session, mobile submission and tracker, with responsive
checks, before treating a paired Preview as an ordering validation environment.
Never copy Production secrets or weaken CORS/protection to obtain a green result.

Backup encryption passwords are byte-exact inputs, unlike transport API tokens.
The conversion reader and recovery writers must preserve the original password,
including surrounding whitespace; never normalize or rotate it to make an archive
readable. Retain authenticated-decryption and immutable-artifact checks.

Provider contracts verified on2026-10-22:
[Vercel protection scopes](https://vercel.com/docs/deployment-protection) and
[exact-domain exceptions](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/deployment-protection-exceptions).
The documented exact-domain exception does not require a paid add-on; this is
not authorization to purchase protection services or expose the application.

## Owner-adopted PR389 application release alternative (2026-10-26)

The owner explicitly adopted local regression, isolated paired Preview acceptance,
protected publication and Production verification for this release. For PR389 only,
this replaces decision 6's persistent-Staging prerequisite; it does not declare
the DR conversion complete or qualify the partially converted environment.

The application source is pinned to
`eb1d925f6cb7d728c054dfdbe96f5c103dde6f96`, tree
`becf8f2a207562521f9f5f5abd82bc9938371ba0`. The two-file policy successor is
`11b7b2a7cf9c79fd3d23bc9761f7aead6cef0d9b`, tree
`a4147b34af6cd5e8fffbeeecb6bbb5d92fa5bccc`. Its source-equivalence claim excludes
only this ADR and `docs/qa/pr389-alternative-release-20261026.md`.

The necessary next safety correction may additionally change only
`.github/workflows/production-application-release.yml`,
`scripts/production-application-target.mjs`,
`scripts/production-application-recovery-plan.mjs`, and their three tests:
`scripts/lib/production-application-target.test.mjs`,
`scripts/lib/production-application-exact-recovery.test.mjs`, and
`scripts/lib/production-application-recovery-plan.test.mjs`. This closes the normal
application path's unspecified previous-deployment rollback and binds recovery
to the immutable approval Plan. It requires independent review and fresh checks;
the earlier documentation-only equivalence does not qualify these controls.
All other application, dependencies, lockfile, build settings, workflows, schema,
migrations and seed inputs remain byte-identical. Any further change requires a
new impact assessment and invalidated acceptance to be rerun.

Retain the candidate PR -> staging -> verified main tree promotion order and all
required checks. A documentation successor has a new commit and full tree and
must obtain its own required CI/security/paired results. Earlier Preview/UI
evidence may support unchanged application behavior only with its original source,
deployment, backend, timestamp and verified source-equivalence record; never
relabel earlier checks as success for a new revision. Clean candidate validation,
required browser/backend acceptance, a verified compatible Primary-only recovery
artifact and fresh immutable application Plan/Apply remain mandatory.

Use only `production-application-release.yml` with `retire_dr_runtime=false`.
The Plan must machine-bind the exact compatible Primary-only recovery artifact,
its original successful protected Apply and raw artifact digest, current Primary
deployment/aliases/configuration and promotion epoch. Reverify before any provider
write and immediately before promotion. An unknown or pending remote operation
does not authorize recovery; first prove the exact operation reached a terminal
state. Reject third-party alias/configuration drift. If the original baseline
remains healthy and unchanged, make no recovery write. Otherwise permit at most
one explicit recovery promotion and read it back even when its CLI returns an
error. A recovered release still failed its original operation. Never use an
unspecified previous deployment, replay a consumed Plan or mark missing evidence
as passed.

This exception excludes PR366 and Production/DR database/schema/Edge publication,
DR conversion, replication changes, Auth provider configuration, secrets,
domains, Access and data cleanup. Normal isolated QA operations in the named
existing paired branch (reviewed migrations, Edge/test-secret provisioning and
owned synthetic fixture cleanup) remain allowed; do not create a replacement
resource or add costs. Do not dispatch Production/DR mutation workflows merely
because their files exist in the promoted tree. Preserve target/source readback;
complete affected-flow verification and owned cleanup after release.

The owner's 2026-10-27 clarification permits necessary Docker tests with cleanup
at test completion. Preserve unrelated services, including carpool. This does
not authorize new costs, retrying previously denied installation/browser
operations, changing origin/controller to evade a denial, or substituting
indirect capture for denied technical evidence. An incomplete required case
still blocks release. The source-bound evidence matrix and remaining stops are
recorded in [PR389 alternative release QA](../qa/pr389-alternative-release-20261026.md).

## PR389 closure-freshness correction impact assessment (2026-10-27)

The earlier eight-file release-control allowance above describes that historical
successor. The owner-authorized correction of the newly reproduced Menu/QR
freshness defect is bound to predecessor `cd6f64cd858895718665f857884ae5073d97e289`,
full tree `abcd57605331f4ab3853f1675313a8cc2d7412a5`. Its application/test scope is
limited to these nine files plus this ADR, the QA record and architecture ledger:

- `src/components/use-public-closure-notice.ts` (new shared read-only refresh hook)
- `src/components/public-menu-live-content.tsx` (new Menu client notice boundary)
- `src/components/public-menu-closure-refresh.test.tsx` (new consumer regressions)
- `src/test/stateful-hook-runtime.ts` (new unit-test helper)
- `src/components/qr-order-flow-controller.ts`
- `src/app/store/[identifier]/public-menu-view.tsx`
- `src/app/store/[identifier]/page.tsx`
- `src/app/store/[identifier]/public-menu-view.test.tsx`
- `e2e/staff-kds-print-closure-flow.spec.ts`

Impact: already-open Menu and QR must reflect closure additions, edits and
withdrawals. QR must preserve cart, draft and a valid session; an initially
closed QR may start a session only after closure withdrawal and completion of
existing-order recovery. A delayed recovery lookup must not create a duplicate
or unnecessary session. Failed closure reads must not reopen a known closure.
Use the existing public closures endpoint, visible bounded polling and focus/
visibility refresh; do not change authorization, server ordering checks or
provider configuration to obtain a passing result.

The prior application-byte-equivalence claim does not cover these changed
consumers. Their old Menu/QR acceptance is invalidated: require fresh focused
regressions, lint/type checks, unchanged protected CI/security and paired Preview
qualification, then actual kept-open Menu/QR add/edit/remove UI and owned cleanup.
Local mocked hook evidence is not deployed browser acceptance. Retain original
source/deployment/timestamps for unaffected earlier evidence. Compare the complete
successor tree and prove all files outside this exact scope unchanged.

This amendment changes no dependency, lockfile, schema, migration, seed, Edge,
resilience, release workflow or provider setting. In particular the 22 fixed
recovery-compatibility scopes and full main/staging tree equality checks remain
unchanged. It adds no release waiver, cost, DR conversion, retry of denied
operations or replacement capture route. The bounded PR389 alternative remains
subject to all required technical acceptance, protected promotion, immutable
Plan/Apply and live Production affected-flow verification.
