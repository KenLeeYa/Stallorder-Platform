# Primary credential rotation preparation

Status: Proposed; no Primary password, GitHub credential, Vercel environment or Production deployment has been changed.

The owner explicitly authorized a coordinated Primary password reset and GitHub/Vercel synchronization, followed by the original delivery release after acceptance, without additional fees. The two stored passwords failed their separate bounded native diagnostics. The current credential is unknown, so rolling back to the existing deployment after resetting that password would not by itself restore database access.

Vercel environment changes apply to new deployments. Establish an independently usable overlap credential, validate the same application and affected login/order paths in the existing isolated environment, and prepare a compatible recovery deployment before changing the original credential. Do not treat a successful connection or metadata check as application acceptance. Primary has 200 FORCE RLS public tables; inherited object privileges alone are not equivalent to the current postgres session.

The official [database password endpoint](https://supabase.com/docs/reference/api/v1-update-database-password) avoids putting the password in SQL. The experimental [CLI login-role endpoint](https://supabase.com/docs/reference/api/v1-create-login-role) offers a temporary credential; its actual role, permissions, expiry and suitability must be established before considering it for an overlap. A short TTL or incompatible role is a blocker, not permission to extend privileges or bypass RLS. See [secret logging guidance](https://supabase.com/kb/troubleshooting/provisioning-credentials-without-log-exposure) and [Vercel environment behavior](https://vercel.com/docs/environment-variables).

## Isolated capability qualification

`delivery-credential-preview.yml` is a manual owner/main-only entry on an ordinary GitHub-hosted runner, using the existing protected Preview environment and shared PR389 writer lock. Main and staging trees must agree. It accepts only the first attempt of a run and has no inputs selecting a project, role, SQL or credential.

The module binds the existing data-less PR389 project `teunnvfakbfzmodajqjz`, verifies its actual pooler, and refuses to issue a role if any CLI login role already exists. It records a non-secret intent, makes one role-issuance request, retains the returned secret only in process memory, and uses a fixed read-only native query to record actual current/session identities and RLS-bypass state. The native client inherits only fixed libpq fields and PATH; it does not receive provider tokens.

A strictly validated returned role is removed with one exact `DROP ROLE`, including after native or credential-shape failure. Readback must confirm the CLI-role inventory returned to empty. The bulk-delete endpoint is never used. An unknown issuance outcome, invalid role name, cancellation, or failed cleanup remains unresolved and blocks continuation; it is never retried or guessed into a cleanup target. A cancelled job may require manual reconciliation from the original non-secret intent/issued receipt before another run.

The result always retains `rotationQualified: false` and `releaseAuthorized: false`. No Primary write, password reset, Vercel action, privilege grant, reusable credential export, new project/branch or paid provider call is implemented by this workflow. Actual application compatibility and a sufficiently durable recovery window remain separate requirements.

## Current evidence

- Local transport probe was independently reviewed; Windows current-user DPAPI roundtrip and failure/redaction cases passed. Its first read-only child-project lookup returned HTTP 404 with the local credential. No role-issuance request was sent, and no intent or credential file was created. The hosted candidate uses the already established Preview credential context instead.
- A separate Preview-only NOLOGIN/BYPASSRLS capability transaction could not grant membership in postgres because the caller lacks ADMIN option. It rolled back; fresh readback found zero probe roles. No permissions were relaxed and Primary was unaffected.
- The new hosted module's 16 focused tests pass, covering context rejection, existing-role refusal, one-shot unknown outcomes, invalid TTL, native failure, exact cleanup, redaction and Primary-write rejection. Independent review passed these tests plus 24 additional negative/cleanup cases with no findings; receipt SHA256 is `f1739bbb5f464d4f59626de1e90005e3c561563c169ff1b149a05b265ed2d565`. Actual hosted execution remains pending.
- The final control suite passes 1,189/1,189 with no skips; raw log SHA256 is `6bc07fcd5086bfa3f1ebba6ade18177f2eaf4d9684cbdfd09085df2f5df625a9`. Scoped lint, 31 workflow contracts, YAML parsing and production guardrails pass. The separate installation binding review found no code issues and independently passed 94 cases, receipt `16ee11f2a750ef89a0d66edcb9d6ba09cade97f8e0de4ba2a46712e137441624`.
- The original product Run19 expired at `2026-11-14T08:30:52Z`; its timestamps must not be renewed. Fresh product/security evidence is required later, after the remaining release engineering and recovery gates are ready.

## Remaining coordinated rotation

Qualify a supported overlap and the actual application; prepare protected target/credential synchronization and known-outcome recovery; move the application to the verified overlap; reset postgres through its password API; synchronize GitHub and production-scoped Vercel values through secret-safe transport; validate the new native credential and application; move off and retire the overlap only after dependent deployments no longer need it. Unknown outcomes stop subsequent writes and require readback. The original delivery DB/Edge/App release and live ordering acceptance still follow these steps.
