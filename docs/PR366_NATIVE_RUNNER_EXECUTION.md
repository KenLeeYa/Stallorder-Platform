# PR366 native PostgreSQL qualification on the existing preparation branch

This is a synthetic, non-Docker qualification job. It is not a protected publisher, a full platform recovery, or a release gate. Production remains dependent on successful Staging acceptance.

## Execution boundary

The installed workflow is [pr366-native-postgres.yml](../.github/workflows/pr366-native-postgres.yml). It accepts only a non-forced push to the existing codex/primary-only-preparation branch, limited to its six execution-source paths. main/staging and their protection settings remain unchanged. GitHub workflow_dispatch requires the workflow on the default branch, so this candidate uses a branch-specific push without installing on main. No PR is created for this executor.

One public standard ubuntu-24.04 VM runs for at most 35 minutes, with permissions: {}, no secrets, paid runner, Docker/services, artifact/cache upload, or external database credentials. Source checkout is anonymous and bound to the event SHA; branch deletion, force pushes, forks/private repositories, other hosts and ambient credential/runtime overrides fail closed. Only this preparation branch is disabled in Vercel git.deploymentEnabled; other branch rules are preserved. Read back GitHub runs and Vercel deployments after each authorized push.

## Native acceptance

The probe fixes Supabase postgres commit c2c2d5c7b31f87d41f26481661eb762c00300855, its PG17.6 portable CLI recipe, Nix 2.34.9 installer checksum and signed upstream cache key. It does not allow IFD, source-build fallback, moved lock files or unsigned cache closure. Cache, ABI, quota and timeout failures are evidence of incomplete qualification, never permission to weaken these conditions.

A successful run must read back five SQL extensions and two preload/library checks, then test synthetic FORCE RLS roles and SQLSTATE denials, dump, restore into a separately initialized empty cluster, compare catalog/data and repeat the authorization checks. TCP is disabled. Synthetic public key material cannot be used for real backups. Both clusters must stop, with pg_ctl status=3 and no postmaster PID, before the owned temporary directory is removed. The runner VM owns Nix store/profile teardown.

Six source files are checked against the immutable Git commit before and after execution: probe, tests, workflow, Vercel branch guard and two exact-byte SQL fixtures. Raw commands, exit states, stdout/stderr, runtime versions/digests, run ID/attempt/image and cleanup appear in the job log. An interrupted or incomplete run is not a pass.

## Remaining release gates

Even a successful synthetic job keeps recoveryQualified, protectedPublicationQualified and releaseEligible false. It does not replay the 146 baseline / 173 candidate migrations, 146+27 upgrade, Auth/Storage schemas, physical S3 bytes, actual paired encrypted archives, protected attestation or independent custody. Those require separately qualified infrastructure and permission isolation. The job does not consume real keys, archives, tokens or customer data.

Independent custody must exclude candidate writers/runners from administration, rollback/PITR, secret/binding changes and minimum-epoch reset. A second key or namespace under the same administrator is insufficient. An isolated S3 backend must preserve physical metadata/version keys, prove expected owner/create-only writes, empty full inventory and a common DB/Storage write fence. Free allowances with uncapped overage are not zero-cost authorization.

No failed dependency installation, policy-refused cleanup, formal key action or support submission is retried by this workflow. Existing local work and carpool services remain untouched.
