# DR Project Conversion Plan

## Approval gate

The user approved converting the former `stallorder-staging` project into the
Production DR candidate after the paired ephemeral Preview workflow passed its
exit criteria. The destructive conversion is performed only by the protected
`production-dr-operations.yml` bootstrap operation after encrypted backup and
restore verification. Persistent feature testing now uses a data-less Supabase
Preview Branch paired with the same Pull Request's Vercel Preview.

## Preconditions

- Ephemeral Supabase Preview Branch and Vercel Preview have completed full QA.
- Staging has no unique test data, Auth user or Storage object that must remain.
- Encrypted logical backup and restore test are complete.
- Production and candidate DR migration histories match.
- Production customer data is not copied into a Preview environment.
- DR Google OAuth callbacks, Turnstile domains and Storage bucket configuration
  have been reviewed.

## Conversion sequence

1. Freeze new Staging test activity and inventory schemas, rows, Auth users,
   Storage objects, extensions, cron jobs and Vault references.
2. Export an encrypted backup to an approved restricted location.
3. Verify the backup by restoring into an isolated temporary project.
4. Remove synthetic accounts and objects only after backup verification.
5. Disable demo seed, application writes, outbound jobs and customer
   notifications.
6. Rotate Staging-only credentials without placing values in source or reports.
7. Apply Production-compatible migrations.
8. Set the environment-local current row to `DR`,
   `READ_ONLY_STANDBY`, `writes_enabled=false`,
   `enforcement_enabled=true`.
9. Enable the database-level `app.backend_fencing_enabled=on` setting and
   reconnect pooled sessions.
10. Validate that the harmless fencing probe rejects a business write.
11. Configure DR Auth, Storage and mirrored Edge Functions.
12. Run `npm run dr:replication:plan`, review the output, then use the documented
    approval path for the apply command.
13. Verify copy completion, lag, row counts, RLS, grants and checksums.
14. Rename the project display name to `stallorder-dr` through the authenticated
    Management API and record sanitized workflow evidence.

## Required production values

```text
APP_ENV=production
ALLOW_DEMO_SEED=false
TURNSTILE_ALLOW_TEST_KEYS=false
AUTH_PROJECT_CODE=DR
BACKEND_ACTIVE_TARGET=PRIMARY
```

No value in this list is a credential.

## Rollback

Before application traffic reaches DR:

1. Disable and remove the DR subscription.
2. Remove the Primary publication.
3. Keep DR fenced.
4. Restore the encrypted Staging backup only after explicit approval.
5. Restore Staging OAuth and environment configuration.
6. Validate Staging login and synthetic test data before reopening it.
