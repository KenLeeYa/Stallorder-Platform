# Staging and Production Release Workflow

StallOrder uses two isolated environments. Code and migrations must be verified
in Staging before the same source tree is promoted to Production.

| Environment | Git branch | Application URL | Supabase project |
| --- | --- | --- | --- |
| Staging | `staging` | `https://staging.qidaigo.com` | `stallorder-staging` |
| Production | `main` | `https://app.qidaigo.com` | `stallorder-production` |

## Required release order

1. Create a feature branch from the latest `staging` branch.
2. Open a Pull Request to `staging`.
3. Merge only after CI passes.
4. The `Production Readiness` workflow automatically:
   - runs lint, typecheck, unit tests, database tests, build and audit;
   - applies migrations to the Staging Supabase project;
   - verifies migration history and remote database lint;
   - waits for the Vercel deployment for the same commit;
   - runs the protected Staging smoke test.
5. Perform functional QA at `https://staging.qidaigo.com` with Staging test
   accounts. Test data must remain in Staging.
6. Open a Pull Request from `staging` to `main`.
7. Merge only after Staging QA is accepted.
8. The same workflow applies and verifies Production migrations, waits for the
   matching Vercel deployment, and runs the Production smoke test.

Production deployment is rejected when the `main` source tree differs from the
verified `staging` source tree. This prevents Production-only application or
migration updates.

## GitHub Environment configuration

The `staging` and `production` GitHub Environments must each contain:

- Secret `SUPABASE_ACCESS_TOKEN`
- Variable `SUPABASE_PROJECT_REF`
- Variable `APP_BASE_URL`

Staging also contains:

- Secret `VERCEL_AUTOMATION_BYPASS_SECRET`

Secrets must never be committed, printed in logs, or shared between Supabase
projects unless the provider explicitly requires one project-level value.

## Data isolation

- Staging test accounts, orders and fixtures are never copied to Production.
- Production customer data is never copied to Staging.
- Schema migrations are shared; environment data is isolated.
- Do not run seed or database reset commands against either remote environment.

## Rollback

- Application: revert the release commit and wait for the corresponding Vercel
  deployment.
- Database: use a new forward-only corrective migration. Never edit an applied
  migration or run a remote reset.
- If Staging validation fails, stop before opening or merging the
  `staging`-to-`main` Pull Request.
