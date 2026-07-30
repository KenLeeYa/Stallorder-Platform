# StallOrder Production Resilience Master Audit

## Document status

- Audit date: 2026-07-29
- Repository: `KenLeeYa/Stallorder-Platform`
- Audit branch: `feature/production-resilience-master`
- Base branch and revision: `origin/main` at `bae692f`
- Production application: `https://app.qidaigo.com`
- Production Supabase project: `stallorder-production` (`eyuctbnlvnbnivwasvqr`)
- Persistent Staging Supabase project: `stallorder-staging` (`daeqwtpaxcebmtwxqdkj`)
- Default region: Tokyo (`ap-northeast-1` / Vercel `hnd1`)

This is an audit and feasibility gate. It does not change application runtime,
database schema, cloud configuration, DNS, secrets, or customer data.

The target architecture is intentionally **not** a multi-writer database:

```text
Global cached public menu
+ stateless online compute paths
+ one authoritative writable PostgreSQL Primary
+ one asynchronous read-only DR standby
+ controlled, fenced promotion
+ one approved Offline Leader device per Stall
```

## Evidence scope

The audit covered:

- `README.md`, `package.json`, `next.config.ts`, `vercel.json`
- `public/sw.js`, `src/app/manifest.ts`, `src/components/pwa-runtime.tsx`
- `src/app/**`, `src/components/**`, `src/lib/**`, `src/server/**`
- `prisma/schema.prisma`, `prisma/seed.ts`
- `supabase/config.toml`, five Edge Functions, 53 migrations and 27 pgTAP files
- `.github/workflows/ci.yml` and `.github/workflows/production-readiness.yml`
- open and recently merged GitHub Pull Requests
- GitHub Environments, environment variable names and secret names
- authenticated, read-only Supabase project, backup, migration, Storage and
  PostgreSQL metadata
- authenticated, read-only Vercel project and deployment metadata
- current Supabase and Vercel product documentation

No secret value, connection string, production row, Auth identity, customer
note, pickup code or payment reference was read into this document.

## Inventory summary

| Area | Verified state |
| --- | --- |
| Runtime | Node 24, Next.js 16.2.11, React 19.2.4, Prisma 6.19 |
| API surface | 88 Next.js route handlers; no Server Actions |
| Supabase Functions | `create-order-session`, `create-public-order`, `get-public-order`, `manage-line-link`, `prepare-reorder` |
| Database | PostgreSQL 17.6, 86 Prisma models / 86 Production `public` tables |
| Migrations | Local, Staging and Production contain the same 53 migration versions |
| RLS | 86 of 86 Production `public` tables have RLS enabled; 72 policies |
| Production schedules | Nine active `pg_cron` jobs |
| Production backups | Seven completed daily physical backups; PITR disabled |
| Storage | Public `product-images` bucket, 5 MiB limit, currently empty in Production and Staging |
| Vercel | Production and Staging deployments execute in `hnd1`; Fluid compute enabled |
| GitHub PR state | No open Pull Requests at audit time |
| Persistent environments | `Preview`, `staging`, `production`; no approval reviewers or protection rules |

## Existing reusable implementation

### Security and authoritative writes

- Multi-tenant and multi-stall authorization is enforced through
  `src/lib/authorization.ts`, server-side membership resolution and RLS.
- All 86 Production `public` tables have RLS enabled.
- RLS helper hardening is present in
  `supabase/migrations/20260724175025_security_advisor_hardening.sql`.
- Trusted public-order RPCs revoke access from `public`, `anon` and
  `authenticated`, then grant only `service_role`. The established pattern is
  visible in `supabase/migrations/20260713000200_order_abuse_controls.sql`.
- Public orders use short-lived, hashed, one-use sessions, server-side
  Turnstile validation, rate limits, idempotency, trusted server-side price
  calculation and audit attempts in:
  - `supabase/functions/create-order-session/index.ts`
  - `supabase/functions/create-public-order/index.ts`
  - `supabase/migrations/20260713000200_order_abuse_controls.sql`
- The Next.js proxy in
  `src/app/api/public-order/[functionName]/route.ts` has an explicit allowlist
  containing only the five public Edge Functions.
- Test setup orders use `orders.is_test=true`; billing and summary paths exclude
  them. This can be extended to system canaries.
- Existing commercial entitlements are enforced server-side by
  `src/server/billing/entitlement-service.ts` and are not only UI flags.

### Database access and online rendering

- `src/lib/prisma.ts` uses lazy singleton initialization and does not construct a
  client per request.
- `prisma/schema.prisma` separates pooled runtime `DATABASE_URL` from
  migration/admin `DIRECT_URL`.
- `.env.example` documents a transaction-pooler runtime URL and a direct
  migration URL without real credentials.
- The root `src/app/layout.tsx` does not resolve a session or query the
  database. Authenticated layouts resolve their own authorization context.
- Vercel functions are explicitly deployed to `hnd1` in `vercel.json`, matching
  the Supabase Tokyo region.

### Public menu and order intake

- `src/lib/public-menu.ts` caches public QR context for 15 seconds and public
  menu data for 45 seconds with stall-scoped cache tags.
- `src/app/q/[qrToken]/page.tsx` renders the menu from the cached server result.
- Capacity is loaded independently from menu data.
- Order creation always revalidates current product, price, availability,
  schedule, capacity, session, abuse and idempotency state on the authoritative
  database.
- The browser can call a Supabase Edge Function directly or the allowlisted
  Next.js proxy through `src/lib/public-order-client.ts`.

This is useful compute-path reuse, but both paths currently target the same
Supabase project and database. It is not yet an independent intake circuit or
DR path.

### Realtime degradation

- Staff orders use SSE first, optional Supabase Realtime second and polling as a
  fallback in `src/components/staff-order-board.tsx`.
- KDS uses SSE plus 12-second authoritative polling in
  `src/components/kitchen-board.tsx`.
- CDS uses SSE plus 12-second authoritative polling in
  `src/components/pickup-display-board.tsx`.
- The merchant dashboard uses Realtime notifications plus 45-second polling in
  `src/components/multi-stall-dashboard.tsx`.
- SSE routes persist no independent truth; they poll PostgreSQL and notify the
  browser to re-fetch:
  - `src/app/api/stalls/[stallSlug]/orders/stream/route.ts`
  - `src/app/api/stalls/[stallSlug]/kitchen/stream/route.ts`

This matches the correct rule: PostgreSQL is authoritative and Realtime/SSE is
only a notification channel.

### Existing POS, KDS, cash and print primitives

- Staff order operation exists in `src/components/staff-order-board.tsx`.
- KDS station, task, status and access primitives exist in:
  - `src/lib/kitchen.ts`
  - `src/components/kitchen-board.tsx`
  - `src/app/kitchen/**`
- Cash shifts and movements exist in `src/lib/cash-shifts.ts` and related route
  handlers.
- Server-backed print queue states, retry, reprint and printer heartbeat exist
  in `src/lib/print-queue.ts` and `src/components/print-queue-board.tsx`.
- Prisma already models order snapshots, cash shifts, cash movements,
  production tasks and print jobs in `prisma/schema.prisma`.

These domain rules should be reused by offline import. The browser must not
create a second set of canonical order rules.

### PWA and monitoring

- `src/components/pwa-runtime.tsx` registers the Service Worker, reports network
  quality, supports install and Wake Lock, and deliberately blocks non-GET
  requests while offline.
- `public/sw.js` caches the offline page, icons and versioned Next.js static
  assets and provides a navigation fallback.
- Structured request timing, Vercel Analytics and Speed Insights are already
  present.
- `src/app/api/health/route.ts` verifies a basic database query.
- Production has `pg_stat_statements`, `pg_cron` and `pg_net` enabled.

### Release and scheduled-job safeguards

- CI runs lint, types, unit tests, local Supabase reset, pgTAP, database lint,
  build and dependency audit.
- The current production workflow checks that a Production promotion matches
  the verified Staging source tree before applying remote migrations.
- Database-only order expiration is owned by `pg_cron`; an earlier duplicate
  Vercel order-expiration cron was removed by
  `20260718181009_disable_duplicate_vercel_order_expiry_cron.sql`.
- Production currently has nine named jobs. Command bodies were deliberately
  not included in audit output because they may contain protected request
  configuration.

## Missing implementation

### Online and backend resilience

- There is no stable, signed active-backend configuration resolver.
- Runtime database, Auth, Storage, Realtime and Functions settings each point to
  one Supabase project.
- There is no Primary/DR role model, fencing token, promotion epoch, write lease
  or state machine.
- There is no independently deployed second order-intake implementation with
  separate health and circuit-breaker state.
- The current Edge/Next paths share one Supabase Functions URL and one database.
- There is no fail-closed QR degraded state based on authoritative writer
  availability.
- `/api/health` does not distinguish liveness, readiness, dependency health,
  active backend, role, promotion epoch, replication lag or circuit health.
- There is no independent status service outside Vercel and Supabase.

### DR data plane

- No DR project is assigned as a read-only Production standby.
- No publication, subscription or replication slot exists for StallOrder
  application tables.
- No lag, slot growth, replay error, sequence state or schema drift monitor
  exists.
- No fenced promotion, failback or split-brain guard exists.
- DDL and sequence synchronization are not automated.
- Auth project settings, OAuth callbacks, signing keys and identity mapping do
  not have a DR runbook or tested implementation.
- Storage objects are not mirrored. Database replication would copy object
  metadata at most, not the objects themselves.
- Scheduled jobs do not have a promotion-aware ownership lease; starting them
  on two projects could duplicate work.
- No warm-standby restore automation exists if logical replication proves
  unsupported.

### Offline Staff POS

- There is no IndexedDB schema, durable queue, transactional outbox/inbox,
  foreground sync engine or Background Sync handler.
- There is no approved-device registry, Offline Leader lease, offline permit,
  revocation, promotion epoch or per-device risk policy.
- There is no signed menu snapshot for offline price and availability use.
- There is no offline order/cash/print state model, receipt or conflict inbox.
- There is no encrypted emergency export.
- PWA offline mode is intentionally read-only and existing E2E tests assert
  `OFFLINE_READ_ONLY`.
- `localStorage` contains only preferences, QR cart drafts and display state. It
  is not a durable, transactional sales ledger.

### Release validation

- No ephemeral Supabase Preview Branch currently exists.
- The GitHub `Preview` environment has no isolated Supabase configuration.
- There is no PR workflow that creates, migrates, seeds, validates and deletes
  an ephemeral Supabase branch.
- GitHub `staging` and `production` environments have no required reviewers or
  deployment protection rules.
- Persistent Staging must remain in service until the ephemeral replacement is
  proven. It must not be repurposed as DR without explicit review.
- The package requires Node 24, while both GitHub workflows configure Node 22.

## Duplicated or unsafe logic

| Finding | Risk | Required correction |
| --- | --- | --- |
| Edge-direct and Next-proxy public calls both use the same Supabase backend | Gives the appearance of two circuits without independent failure domains | Introduce a backend resolver and separately observable Circuit A/B while retaining one authoritative writer |
| Supabase origins and public endpoints are configured in several server/Edge/browser locations | Drift during promotion can send traffic to mixed projects | Use stable server-side availability configuration; expose only public, non-secret state |
| Service Worker calls `self.skipWaiting()` immediately | A release can replace active code while unsynchronized data exists | Gate activation when a durable queue is pending and provide explicit update state |
| Service Worker activation deletes old caches immediately | Pending offline UI/code compatibility may be lost | Version durable schema separately and retain compatible assets until migration succeeds |
| Browser runtime globally monkeypatches `fetch` to reject offline writes | Correct for the current read-only design, but incompatible with a scoped Offline POS queue | Keep default fail-closed behavior and allow only explicit offline POS commands |
| Database-backed jobs have no backend-role lease | A copied DR project could execute duplicate jobs | Fence jobs by active writer, epoch and idempotent ownership |
| GitHub workflow Node 22 differs from declared Node 24 | CI may validate a runtime different from Vercel | Align CI with the declared production major version |

## Current single points of failure

1. Supabase Production project is the only writable database and API backend.
2. Supabase Auth is the only online identity provider and token issuer.
3. Supabase Storage is the only product-image object source.
4. Public Edge and Next proxy paths converge on the same Supabase project.
5. Vercel Node function automatic cross-region failover is not available on the
   current Pro plan.
6. Active backend configuration is static environment configuration.
7. Public QR ordering has no authoritative writer outage mode beyond a generic
   request failure.
8. Staff POS cannot create orders during a complete writable-backend outage.
9. Production incident communication depends on the same operational stack;
   there is no independent status endpoint.

Vercel `hnd1` itself uses availability-zone redundancy, but this does not remove
the single Supabase backend dependency.

## Current RTO and RPO assumptions

No measured DR RTO or RPO exists today.

| Scenario | Current behavior | Current defensible objective |
| --- | --- | --- |
| One browser Realtime/SSE path fails | Polling recovers within roughly 5-45 seconds depending on screen | RTO below one polling interval; RPO 0 because PostgreSQL is authoritative |
| Supabase Edge Function path fails but Supabase project is healthy | Next proxy may still be used, but it targets the same Functions service/backend | Not an independent recovery path; no committed RTO |
| Writable Production database fails | QR and online staff writes fail | No online recovery RTO; no false-success allowance |
| Production project loss with daily backup restore | Manual restore/new-project setup | RPO may approach 24 hours; RTO is unmeasured and includes manual Auth, Storage and endpoint work |
| Staff device loses network | Existing PWA becomes read-only | RPO for new sales is not applicable because writes are unavailable |

Production has seven completed daily physical backups and WAL-G enabled, but
PITR is disabled. A daily backup alone cannot meet a sub-day RPO.

Target values must not be advertised until measured in an isolated drill. The
initial engineering targets for design are:

- logical-replication DR: RPO <= 5 minutes and controlled-promotion RTO <= 30
  minutes;
- warm-backup fallback: RPO <= 24 hours until scheduled encrypted logical
  backup is added, and RTO <= 4 hours after the full restore runbook is proven;
- Offline Leader: local RPO 0 for committed IndexedDB transactions, with server
  RPO equal to pending queue age.

These are targets, not current guarantees.

## Production migration risks

1. **Split brain:** enabling writes or schedulers on both projects without a
   lease and epoch can duplicate orders, invoices, notifications and schedules.
2. **Schema drift:** PostgreSQL logical replication does not replicate DDL.
3. **Sequence drift:** sequence values need explicit synchronization before
   promotion and failback.
4. **RLS/RPC drift:** copied tables without the exact policies, grants,
   `SECURITY DEFINER` ownership and `search_path` are unsafe.
5. **Auth mismatch:** Supabase Auth URLs, signing material, API keys, provider
   settings and user IDs are project-specific.
6. **Session continuity:** application sessions are database-backed and may be
   copied, but Google/Supabase Auth continuity still depends on project-specific
   configuration and token validation.
7. **Storage mismatch:** copying `storage.objects` rows does not copy image
   bytes.
8. **Cron duplication:** restored or replicated scheduling metadata must remain
   disabled until promotion ownership is acquired.
9. **Migration compatibility:** every future migration must be expand/migrate/
   contract and remain compatible with the previous app version during rolling
   release and rollback.
10. **Customer data:** Production customer/Auth/Storage data must never seed a
    Preview Branch or destructive drill.

No existing applied migration may be edited to solve these risks.

## Browser offline limitations

- Service Workers may be suspended or terminated at any time.
- Background Sync availability and execution timing differ by browser and are
  especially constrained on iOS.
- IndexedDB is durable relative to `localStorage`, but storage can still be
  evicted, cleared by the user, unavailable in private browsing or lost with
  device damage.
- `navigator.storage.persist()` is a request, not a guarantee.
- A web application cannot absolutely prevent clearing browser data,
  uninstalling a PWA, logging out or resetting a device.
- Multiple tabs require a Web Lock or equivalent single coordinator, durable
  idempotency and lease expiry.
- Multiple disconnected devices cannot safely share inventory, order numbers,
  cash shifts or KDS truth without an on-site gateway.
- Offline provider-authorized card/wallet payment cannot be represented as
  confirmed without provider authorization.

The safe Phase 1 policy is one approved Offline Leader per Stall. Other
disconnected devices must be read-only.

## Provider and plan limitations

### Supabase

- Both current projects are healthy PostgreSQL 17 projects in Tokyo.
- Production reports `wal_level=logical`, five replication slots, five WAL
  senders and a 512 MiB slot WAL retention cap. This proves source-side WAL
  capability only.
- There is no application publication, slot or destination subscription.
- Destination connectivity, replication-role privileges, subscription
  creation, table coverage, DDL/sequence procedures and promotion/failback have
  not been proven end-to-end.
- Current Supabase Branch lists are empty. Branching availability and billing
  must be proven before replacing persistent Staging.
- Pro daily backups are available, but PITR is currently disabled. PITR also
  has a compute-size prerequisite and additional cost.
- Restore-to-new-project does not automatically restore Storage objects, Edge
  Functions, Auth provider settings/API keys, Realtime settings or every
  extension setting.
- Supabase read replicas are read-only and are not treated here as a supported
  writable promotion mechanism.
- Same-region Tokyo DR does not cover a Tokyo regional outage.

### Vercel

- Actual Production and Staging deployments report `hnd1`.
- Pro supports multiple active function regions, but the application database
  remains single-region and multi-region compute would add latency and
  complexity.
- Node.js `functionFailoverRegions` is an Enterprise feature and must not be
  added to this Pro project.
- Fluid compute and `hnd1` multi-AZ resilience are enabled, but they do not
  replace a second independently controlled compute circuit.

### External providers

- Cloudflare Turnstile remains mandatory for public order submission; degraded
  QR behavior must fail closed rather than bypass it.
- Google OAuth continuity requires separately configured, authorized callback
  URLs and Supabase Auth provider settings for the active project.
- LINE notification failure is already asynchronous and must not block order
  state; LINE Pay/JKO Pay currently behave as manual payment labels, not
  provider-confirmed adapters.
- Automated commercial billing provider adapters remain disabled stubs and must
  not be treated as a tested payment failover.

## Feasibility gate result

| Gate | Result | Evidence / limitation |
| --- | --- | --- |
| One authoritative writer | Ready as architecture rule | Existing code has one Production writer |
| Source logical WAL | Warning | Source settings support logical WAL, but end-to-end replication is unproven |
| Isolated replication proof | Blocked | No ephemeral project/branch has been provisioned for destructive proof |
| Automatic Vercel Node region failover | Unsupported on current plan | Enterprise-only `functionFailoverRegions`; do not commit it |
| Two independent intake circuits | Missing | Current direct/proxy routes converge on one Supabase backend |
| Ephemeral release validation | Missing | No Preview Branch workflow or isolated Preview environment configuration |
| Persistent Staging removal | Not permitted yet | Safe replacement is not proven |
| Durable Offline POS | Missing | Current offline policy is deliberately read-only |
| Storage/Auth DR | Missing | Neither is covered by logical table replication alone |
| Measured RTO/RPO | Missing | No isolated promotion/failback drill has been run |

The master prompt requires work to stop and report when proposed replication or
Vercel features are unsupported. Automatic Vercel Node function failover is
unsupported on the current Pro plan, and logical replication is not yet proven
end-to-end. No runtime or infrastructure implementation should proceed past P0
until the supported compute fallback and isolated DR proof path are approved.

## Recommended implementation order

1. **P0 completion**
   - Keep persistent Staging intact.
   - Align CI to Node 24.
   - Add GitHub environment reviewers/protection.
   - Prove whether Supabase Preview Branches are available.
   - Provision an isolated, synthetic-only replication target or select the
     warm-backup fallback.
   - Measure initial RTO/RPO in that isolated environment.
2. **P1 safe release and health**
   - Add ephemeral validation before removing persistent Staging.
   - Add dependency-specific readiness, active-backend metadata, canary and an
     independent status design.
   - Add server-enforced feature flags and kill switches.
3. **P2 supported dual compute path**
   - Reuse the same trusted RPCs and idempotency keys.
   - Add separately observable Edge and Next intake circuits with circuit
     breakers.
   - Do not claim Vercel automatic regional failover; use supported deployment
     and operational fallback.
4. **P3 DR data foundation**
   - Choose logical replication only after isolated proof.
   - Otherwise implement scheduled encrypted logical backup, daily/PITR restore,
     schema-synchronized warm DR, Storage mirror and measured runbooks.
   - Add backend role, fencing, epoch, read lag and scheduler ownership.
5. **P4 offline foundation**
   - Add IndexedDB, persistent-storage check, approved devices, one Offline
     Leader, signed offline permit, signed menu snapshot and safe SW updates.
6. **P5 offline operations**
   - Add local order/cash/print outbox, foreground/background replay,
     transactional import, receipts, conflict inbox and emergency export.
7. **P6 controlled failover**
   - Add dry-run, promotion, failback and epoch-aware offline replay.
8. **P7 degraded UX and payment fallback**
   - Keep cached menus visible, disable QR submit without an authoritative
     writer, direct customers to counter ordering and expose provider health.
9. **P8 game day**
   - Run only isolated failure injection, offline reload/update tests, DR
     promotion/failback drills and operational training.
10. **P9 future local gateway**
    - Documentation only; do not introduce a gateway or multi-device offline
      writer in this project phase.

## Required decision before implementation continues

Select and approve a supported P0 path:

1. Keep Vercel Pro and implement two application circuits without Enterprise
   automatic region failover; prove Supabase logical replication in a new
   isolated synthetic-only project/Preview Branch.
2. Keep Vercel Pro and use the documented warm-standby backup/restore fallback
   instead of logical replication.
3. Upgrade Vercel to Enterprise, then re-verify the exact supported failover
   configuration before committing it.

Option 1 is the preferred next proof because it preserves the current plan,
keeps one authoritative writer and avoids claiming unsupported automatic
failover. It still requires an isolated Supabase target and incurs provider
resource cost.

## Official capability references

- Supabase Branching: <https://supabase.com/docs/guides/deployment/branching>
- Supabase Backups and PITR: <https://supabase.com/docs/guides/platform/backups>
- Supabase Restore to a New Project:
  <https://supabase.com/docs/guides/platform/clone-project>
- Supabase logical replication:
  <https://supabase.com/docs/guides/database/replication>
- Supabase external replication setup:
  <https://supabase.com/docs/guides/database/postgres/setup-replication-external>
- Supabase read replicas:
  <https://supabase.com/docs/guides/platform/read-replicas>
- Vercel function regions:
  <https://vercel.com/docs/functions/configuring-functions/region>

