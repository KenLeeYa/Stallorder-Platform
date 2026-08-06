# Ephemeral Preview and Production Release Workflow

StallOrder uses isolated, data-less Supabase Preview Branches paired with
Vercel Previews. The `staging` Git branch remains the source-tree promotion
gate, but it is not a persistent runtime environment.

| Environment       | Git source                   | Application target          | Supabase target                                        |
| ----------------- | ---------------------------- | --------------------------- | ------------------------------------------------------ |
| Ephemeral Preview | Same-repository Pull Request | Matching Vercel Preview URL | Data-less Preview Branch created for that Pull Request |
| Source-tree gate  | `staging`                    | No persistent runtime       | No remote database                                     |
| Production DR     | Verified `main` tree         | No normal public traffic    | Former Staging project, fenced read-only standby       |
| Production        | `main`                       | `https://app.qidaigo.com`   | `stallorder-production` Primary                        |

## Required release order

1. Create a feature branch from the latest `staging` branch.
2. Open a Pull Request to `staging`.
3. Require CI plus the Pull Request's paired data-less Supabase Branch,
   matching Vercel Preview, read-only health/security smoke and synthetic smoke
   tests. The automatic generic Git Preview is a build/frontend signal only;
   it must not connect to Production Primary or DR.
4. Merge to `staging`; the push repeats deterministic local readiness checks
   and must not connect to the Production DR project.
5. Promote the exact verified `staging` tree through a Pull Request to `main`.
6. Merge only after the Production Pull Request repeats CI and paired
   Ephemeral Preview validation.
7. Before a Production database change, run `plan-dr-schema` from `main` with
   `PLAN_PRODUCTION_DR`, review the artifact, and run `dr-schema` with its Plan
   run ID and `APPLY_PRODUCTION_DR_SCHEMA`. This updates and verifies fenced DR
   first without seed, reset or `--include-all`.
8. Run a manual `Production Readiness` Plan from the same `main` commit with
   the successful DR schema Apply run ID. Review its immutable, 24-hour receipt,
   then run Apply with the same DR run ID, the Plan run ID and
   `APPLY_PRODUCTION_RELEASE`.
9. Production Apply verifies both receipts, builds an unaliased deployment,
   applies and lints migrations, deploys and lists every repository Edge
   Function, then promotes that deployment and runs the Production smoke test.
   A failed post-promotion smoke rolls the Vercel alias back.
10. Keep new feature writes disabled. Run `plan-incremental-replication` with
    the successful Production run ID, then run `incremental-replication` with
    its Plan run ID and `UPGRADE_PRODUCTION_DR_REPLICATION`. The operation fails
    closed unless the existing publication/subscription contract is exact.
11. Enable the feature or canary only after the replication snapshot and
    readiness checks pass.

The automatic `main` push Plan is an early signal only; a database-changing
release needs a newly dispatched Plan bound to the completed DR schema run.

Production deployment is rejected when the `main` source tree differs from the
verified `staging` source tree. This prevents Production-only application or
migration updates.

Vercel Git deployment is disabled only for `main` in `vercel.json`. Pull
Request and other branch Previews remain automatic. See
[GITHUB_TWO_STAGE_APPROVAL.md](GITHUB_TWO_STAGE_APPROVAL.md) for the complete
approval and rollback contract.

## GitHub Environment configuration

The `Preview` GitHub Environment contains only the credentials required to
create data-less Supabase Preview Branches and matching Vercel Previews. The
`production` GitHub Environment contains:

- Secret `SUPABASE_ACCESS_TOKEN`
- Secret `PRODUCTION_TEST_QR_URL`
- Variable `SUPABASE_PROJECT_REF`
- Variable `APP_BASE_URL`

`PRODUCTION_TEST_QR_URL` 必須是 `APP_BASE_URL` 同源的專用 `/q/<token>`；
Production Apply 缺少或設定錯誤時會在部署前失敗。發布後 smoke 會載入該
QR，並經正式同源 proxy 建立一個不含訂單的短效安全點餐 session。

Preview automation may also use `VERCEL_AUTOMATION_BYPASS_SECRET`. Generated
Preview connection values are masked and never persisted to GitHub variables.
The former Staging Supabase project is Production DR. It must not be configured
as a `Production Readiness` staging target and must not receive Preview data.

Secrets must never be committed, printed in logs, or shared between Supabase
projects unless the provider explicitly requires one project-level value.

## Data isolation

- Synthetic Preview accounts, orders and fixtures are deleted with the Preview.
- Production customer data is never copied to a Preview Branch.
- Schema migrations are shared; environment data is isolated.
- Do not run seed or database reset commands against Production Primary or DR.

## Rollback

- Application: revert the release commit and wait for the corresponding Vercel
  deployment.
- Database: use a new forward-only corrective migration. Never edit an applied
  migration or run a remote reset.
- If Ephemeral Preview validation fails, stop before promotion to `main`.

## Out-of-order migration recovery

The normal DR-first workflow rejects `include_all_migrations=true`. An
out-of-order migration is therefore an incident, not a routine release option:
stop before any DR or Primary Apply, identify the exact divergence, and use a
separately reviewed forward-only recovery plan. Never reset either Production
database or bypass the DR-schema -> Primary-migration -> replication-upgrade
order.
