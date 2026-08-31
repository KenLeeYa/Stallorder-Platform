# ADR-005: DR hostname and environment domain policy

- Status: Implemented in source; protected remote Plan/Apply not yet run; no DNS or Vercel mutation applied
- Date: 2026-09-01
- Scope: `staging.qidaigo.com`, `dr.qidaigo.com`, `app.qidaigo.com`, Vercel application routing, and Production DR validation

## Context

Persistent Staging has been replaced by paired, data-less Supabase and Vercel Previews. The former Staging Supabase project is now fenced Production DR, but the old `staging.qidaigo.com` application alias remained configured.

Read-only inspection on 2026-09-01 found:

| Surface | Observed state |
| --- | --- |
| Cloudflare `staging.qidaigo.com` | DNS-only CNAME to the current Vercel DNS target |
| Vercel `staging.qidaigo.com` | Verified custom domain bound to Git branch `staging`, without a redirect |
| HTTPS `staging.qidaigo.com/api/health` | `404 DEPLOYMENT_NOT_FOUND` |
| Cloudflare/Vercel `dr.qidaigo.com` | No DNS record and no project-domain binding |
| Cloudflare Access | Not enabled for the account; it cannot currently protect this hostname |
| Vercel plan and project state | Pro plan; no `stallorder-dr` project; project-level Vercel Authentication is available and the Apply must prove `All Deployments` was accepted |
| `app.qidaigo.com/api/health` | Production application responded `200` |
| GitHub Production `APP_BASE_URL` | `https://app.qidaigo.com` |
| Edge CORS source | `supabase/functions/_shared/env.ts` still includes `https://staging.qidaigo.com` in `canonicalPublicOrigins` |

The database project becoming DR does not make a Vercel branch alias a DR application runtime. A hostname is only a route; backend identity still comes from the deployed artifact, encrypted runtime bindings, Supabase project, Edge Functions, Auth, Storage, callbacks, and writer-fencing state.

## Decision

1. `app.qidaigo.com` remains the only customer-facing Production application hostname. A failover changes the protected runtime behind this stable hostname; customers are not sent to a different URL.
2. `dr.qidaigo.com` is reserved for operator-only DR readiness and cutover validation. It must not receive normal public traffic, be indexed, or become a second permanent writer.
3. `dr.qidaigo.com` may be provisioned only after an exact DR deployment exists with DR-specific bindings, `AUTH_PROJECT_CODE=DR`, active-backend/epoch checks, writer fencing, and access protection. Cloudflare Access requires a proxied record; otherwise use an equivalent Vercel deployment-protection control.
4. `staging.qidaigo.com` is a legacy runtime alias and is not Staging. It should be removed from Vercel and Cloudflare after a reviewed Plan/Apply and rollback check. Do not redirect it to `dr.qidaigo.com`, because that would preserve an incorrect environment meaning and expose an operational endpoint.
5. Ephemeral Preview remains the only hosted pre-Production validation environment. The Git branch `staging` remains a source-tree gate and has no persistent hostname or database.
6. The operator entry uses a separate, Git-unlinked Vercel project named `stallorder-dr`, not the customer-facing `stallorder-platform` project. Its deployment uses `vercel.dr.json`, has no Cron jobs, and is built from the exact reviewed `main` commit/tree with DR-only database and Supabase bindings.
7. Because Cloudflare Access is not enabled, the initial DNS record is a DNS-only CNAME and Vercel Authentication must protect all project deployments, including the generated deployment URL and `dr.qidaigo.com`. The Apply aborts and deletes the newly created project if the provider does not return that protection state; it does not purchase or enable a paid protection feature automatically.
8. The protected `/api/health/dr/operator` endpoint is disabled by default and returns `READY` only when the runtime, Supabase project ref/URLs, database identity, promotion epoch, `READ_ONLY_STANDBY` role, disabled writes, and writer-fence enforcement all match. Apply separately checks DR Auth health, Storage health, and that every repository Edge Function is active in the DR project.

## Why a direct rename is unsafe

Replacing the Vercel domain name and DNS record is mechanically small, but binding `dr.qidaigo.com` to the existing `staging` branch would continue returning no deployment. Binding it to the existing Production deployment would serve Primary-backed runtime under a DR label. Either outcome gives false DR evidence.

The required application changes are configuration and verification work rather than broad product-code refactoring, but the affected trust boundary is medium-to-high risk:

| Option | Change size | Risk and result |
| --- | --- | --- |
| Rename the current branch alias only | Small | Incorrect; remains unavailable or labels Primary as DR |
| Reserve `dr.qidaigo.com` without routing traffic | Small | Safe preparatory step, but not DR readiness evidence |
| Permanent public DR site | Medium/large | Expands OAuth, Passkey, origin, Turnstile, callback, monitoring, and dual-writer attack surface; not recommended |
| Stable `app` cutover plus protected `dr` operator probe | Medium one-time setup | Recommended; preserves customer URLs and provides explicit backend/epoch validation |

## Required Plan before any remote mutation

The immutable Plan is created by `.github/workflows/production-dr-operator-entry.yml` and must identify the exact Cloudflare zone, Vercel team/project, source commit/tree, DR runtime epoch, DNS before-state, Vercel domain before-state, access-protection mode, rollback operations, and these checks:

- the `dr` deployment uses DR database, Auth, Storage, Edge Functions, and public-order origin bindings;
- `APP_BASE_URL`, `NEXT_PUBLIC_APP_URL`, `TRUSTED_APP_ORIGINS`, `PUBLIC_APP_ORIGINS`, and `TURNSTILE_EXPECTED_HOSTNAME` agree with the intended host;
- the runtime hard-coded `staging.qidaigo.com` canonical origin and its tests are removed in the reviewed code release; do not add `dr.qidaigo.com` as a global origin for Primary;
- Google, LINE, Apple, Microsoft, Passkey, delivery-provider, payment, and e-invoice callbacks are either explicitly configured for the DR probe or disabled/fail-closed there;
- `/api/availability/config` reports backend `DR` and the expected promotion epoch;
- the DR database is fenced `READ_ONLY_STANDBY` before promotion and is never writable concurrently with Primary;
- monitoring distinguishes public `app` health from protected `dr` readiness;
- the exact Preview-validated artifact is used; no branch-only rebuild is trusted as a cutover artifact.

Apply order:

1. Create the separate `stallorder-dr` project with Vercel Authentication set to `All Deployments`; read it back before deployment.
2. Build the DR-configured deployment without assigning a public domain or Cron jobs.
3. Prove unauthenticated access is rejected; use authenticated `vercel curl` to validate the operator endpoint, database fence, Supabase binding, Auth, Storage, and Edge Functions.
4. Add and verify the `dr.qidaigo.com` Vercel binding.
5. Add the exact DNS-only Cloudflare CNAME recorded by the Plan and verify Vercel sees a configured domain.
6. Prove the custom domain still rejects unauthenticated access and the protected operator endpoint remains `READY`; normal customer traffic remains on `app.qidaigo.com`.
7. Remove the Vercel `staging.qidaigo.com` branch binding and its Cloudflare DNS record.
8. Verify `staging` is retired, `dr` is protected, and `app` remains healthy.

Rollback restores the recorded DNS/domain before-state and removes only the exact Vercel project ID and Cloudflare record ID created by that Apply. It never deletes by name alone and must read the restored state back. It must not change database writer state. A failed DR probe stops before any `app.qidaigo.com` cutover.

## Consequences

- The visible domain name cannot be mistaken for backend authority.
- Customer bookmarks, QR codes, OAuth callbacks, Passkey RP ID, and payment return URLs remain stable through failover.
- DR remains an operational capability, not a parallel public environment.
- Removing the stale Staging alias is low-impact only after the separate DR probe is proven; it is not evidence that DR itself works.
