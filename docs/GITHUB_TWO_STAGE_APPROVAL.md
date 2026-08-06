# GitHub Pro Two-Stage Production Approval

## Purpose

StallOrder uses a private GitHub Pro repository. Native GitHub Environment
Required Reviewers are not available for private repositories on this plan, so
Production changes use an explicit Plan and Apply contract.

The gate covers:

- Production application deployment, Supabase migrations and Edge Functions;
- Production DR schema, incremental replication, bootstrap, failover drill and
  Storage canary; and
- the independent Cloudflare Status Page deployment.

## Immutable Plan receipt

Every Plan creates `production-approval.json` in a GitHub Actions artifact. It
contains only non-sensitive evidence:

- repository and workflow path;
- Plan run ID;
- commit, current tree and verified Staging tree SHA;
- operation and non-sensitive parameters;
- repository owner;
- creation and expiration time; and
- SHA-256 receipt and parameter digests.

It never contains credentials, provider tokens, connection strings, project
references, customer data or response bodies.

Apply downloads the artifact by run ID and verifies it against GitHub's Actions
run API. The operation is rejected unless:

1. Plan completed successfully;
2. Plan and Apply use the same workflow, `main` commit and Staging tree;
3. operation and parameters are identical;
4. both runs were initiated by the repository owner;
5. the receipt is no more than 24 hours old; and
6. Apply supplies the operation-specific confirmation string.

## Production release

`main` Git auto-deployment is disabled in `vercel.json`. Preview deployments
remain enabled.

1. Merge the exact verified `staging` Git tree to `main`. This is a source-tree
   gate, not an online Staging environment.
2. Run `plan-dr-schema` with `PLAN_PRODUCTION_DR`; review it, then run
   `dr-schema` with its Plan run ID and `APPLY_PRODUCTION_DR_SCHEMA`.
3. Manually dispatch the `Production Readiness` Plan from the same `main`
   commit with the successful DR schema Apply run ID. Review the receipt and
   note its run ID.
4. Dispatch `Production Readiness` Apply from the same commit with:
   - `apply_migrations=true`;
   - `include_all_migrations=false`;
   - `dr_schema_run_id=<successful DR schema Apply run>`;
   - `plan_run_id=<reviewed run>`; and
   - `confirmation=APPLY_PRODUCTION_RELEASE`.
5. Apply builds a Production-target Vercel deployment without assigning the
   domain, applies and verifies migrations, deploys and verifies every
   repository Edge Function, promotes the deployment, then runs the Production
   smoke test. The protected `PRODUCTION_TEST_QR_URL` is required and must be a
   same-origin `/q/<token>` route.
6. Keep new feature writes disabled. Run `plan-incremental-replication` with
   `primary_migration_run_id=<successful Production Apply run>`, then run
   `incremental-replication` with that Plan run ID and
   `UPGRADE_PRODUCTION_DR_REPLICATION`.
7. Enable the feature only after the replication snapshot and readiness gate
   succeed.

If the smoke fails after promotion, the workflow rolls the Vercel alias back.
Database migrations remain forward-only and must use an additive or otherwise
backward-compatible migration before old application code is removed.

## DR and Status Page

DR Plan operations use `PLAN_PRODUCTION_DR`. Their matching Apply confirmations
remain:

- `APPLY_PRODUCTION_DR_SCHEMA`;
- `UPGRADE_PRODUCTION_DR_REPLICATION`;
- `CREATE_PRODUCTION_DR`;
- `MEASURE_PRODUCTION_DR`; and
- `PROVE_STORAGE_DR`.

Status Page uses `PLAN_STATUS_PAGE`, followed by `DEPLOY_STATUS_PAGE` with the
successful Plan run ID.

## Branch Rulesets

`main` and `staging` are protected by repository Rulesets that:

- reject branch deletion and force pushes;
- require changes through Pull Requests;
- require the latest target branch before merge; and
- require `verify`, `validate`, and `Vercel` to pass.

The approving review count is zero because the repository currently has one
maintainer. The Production Apply receipt is the explicit owner confirmation.

Ruleset automation defaults to dry-run:

```powershell
$env:GITHUB_REPOSITORY = "KenLeeYa/Stallorder-Platform"
$env:GITHUB_TOKEN = gh auth token
npm run github:rulesets:plan
```

Apply requires `GITHUB_RULESET_CONFIRMATION=APPLY_STALLORDER_BRANCH_RULESETS`.
Rollback removes only the two exact managed names and requires
`GITHUB_RULESET_CONFIRMATION=ROLLBACK_STALLORDER_BRANCH_RULESETS`.

The token is read from process environment, normalized, and never printed or
written to the plan artifact.
