# Ephemeral Preview and Production Release Workflow

StallOrder uses isolated, data-less Supabase Preview Branches paired with
Vercel Previews. The `staging` Git branch remains the source-tree promotion
gate, but it is not a persistent runtime environment.

| Environment       | Git source                   | Application target          | Supabase target                                        |
| ----------------- | ---------------------------- | --------------------------- | ------------------------------------------------------ |
| Ephemeral Preview | Same-repository Pull Request | Matching Vercel Preview URL | Data-less Preview Branch created for that Pull Request |
| Source-tree gate  | `staging`                    | No persistent runtime       | No remote database                                     |
| Production        | `main`                       | `https://app.qidaigo.com`   | `stallorder-production`                                |

## Required release order

1. Create a feature branch from the latest `staging` branch.
2. Open a Pull Request to `staging`.
3. Require CI plus the Pull Request's paired data-less Supabase Branch,
   matching Vercel Preview and synthetic smoke tests.
4. Merge to `staging`; the push repeats deterministic local readiness checks
   and must not connect to the Production DR project.
5. Promote the exact verified `staging` tree through a Pull Request to `main`.
6. Merge only after the Production Pull Request repeats CI and paired
   Ephemeral Preview validation.
7. The `main` push performs the Production migration dry-run and remote lint,
   then uploads an immutable, 24-hour release Plan receipt. It does not apply
   migrations or deploy to Production.
8. The repository owner manually runs `Production Readiness` from the same
   `main` commit with the Plan run ID and `APPLY_PRODUCTION_RELEASE`.
9. Apply verifies the receipt, builds an unaliased Production deployment,
   applies and lints migrations, deploys and lists every repository Edge
   Function, then promotes that deployment and runs the Production smoke test.
   A failed post-promotion smoke rolls the Vercel alias back.

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
The former Staging Supabase project is reserved for Production DR and must not
be configured as a `Production Readiness` staging target.

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

The standard workflow rejects a local migration whose version is older than the
latest remote migration. If a reviewed environment accidentally skipped that
specific migration:

1. Confirm the remote migration list and the exact missing local file.
2. Confirm the full local reset, database tests and database lint pass.
3. Manually run `Production Readiness` from `main` with
   `apply_migrations=false` and `include_all_migrations=true` to produce a
   reviewed Plan receipt.
4. Run it again from the same commit with `apply_migrations=true`, the Plan run
   ID, `include_all_migrations=true`, and confirmation
   `APPLY_PRODUCTION_RELEASE`.
5. Re-run the standard Plan without `include_all_migrations`.

Never enable this recovery option for an unknown remote-only migration or an
unreviewed migration file.
