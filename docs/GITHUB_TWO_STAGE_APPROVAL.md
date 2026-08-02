# GitHub Pro Two-Stage Production Approval

## Purpose

StallOrder uses a private GitHub Pro repository. Native GitHub Environment
Required Reviewers are not available for private repositories on this plan, so
Production changes use an explicit Plan and Apply contract.

The gate covers:

- Production application deployment and Supabase migrations;
- Production DR bootstrap, failover drill and Storage canary; and
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

1. Merge the exact verified Staging tree to `main`.
2. The `main` push runs `Production Readiness`, performs migration dry-run and
   remote lint, and uploads `production-release-plan-<run-id>`.
3. Review the Plan run and note its run ID.
4. Manually dispatch `Production Readiness` from `main` with:
   - `apply_migrations=true`;
   - the same `include_all_migrations` value as the Plan;
   - `plan_run_id=<reviewed run>`; and
   - `confirmation=APPLY_PRODUCTION_RELEASE`.
5. Apply builds a Production-target Vercel deployment without assigning the
   domain, applies and verifies migrations, promotes the deployment, then runs
   the Production smoke test.

If the smoke fails after promotion, the workflow rolls the Vercel alias back.
Database migrations remain forward-only and must use an additive or otherwise
backward-compatible migration before old application code is removed.

## DR and Status Page

DR Plan operations use `PLAN_PRODUCTION_DR`. Their matching Apply confirmations
remain:

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
