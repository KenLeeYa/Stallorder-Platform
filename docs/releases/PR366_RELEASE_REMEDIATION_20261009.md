# PR366 release remediation — 2026-10-09

This is a candidate update, not a released revision. The owner renewed only the exact five-high Web braces dependency exception through Taipei 2026-10-10 00:00; the unchanged advisory, package graph and lock hash remain binding and the audit remains NON_PASS. No CodeQL, Native, live LINE or payment waiver is implied.

## Reviewed changes

- Cloudflare Access readback now uses the existing redirect-rejecting provider helper. A regression executes the actual function against a redirecting synthetic HTTP server; the previous raw-fetch call fails and the corrected call passes without requesting the redirect destination.
- Security scanning reads type, size and bytes from the same file descriptor and checks post-read identity. Prisma generated-code scanning and evidence hashing use the same captured bytes and bind the previous file identity.
- Bundle measurement uses one byte buffer for size/hash. Initial paired runtime contracts and preimage snapshots/manifests/patches use exclusive creation; existing contracts must still compare equal.
- Local synthetic runtime and database checks reserve receipt ownership before starting children or changing data. Asynchronous spawn and evidence failures clean up only the owned child and preserve primary errors. Fixture freeze collisions compare the winner rather than overwrite it.
- Paid acceptance deadlines are bound to individual owners: each pair US$2 management target/at most three hours within Taipei 10/9 00:00–06:00, latest creation04:45, cleanup starts ten minutes before expiry and completes before expiry. Exact actual start/end/run/resources must be recorded before paid creation. Prior receipts cannot substitute for fresh same-source acceptance.

## Evidence and outstanding gates

Independent source reviews found and resolved the runtime asynchronous-error and error-masking issues. Final targeted seven-file suite75PASS; descriptor/Web scope suite58PASS with a20-second synthetic Git-fixture timeout. A prior default-timeout independent run had67PASS/1timeout; its successful isolated rerun does not erase that failure. Final full CI must run on the committed candidate.

Production baseline: provider readback identifies Primary projectprj_uoG4FNJIgnF1LdKRiXnfRaieXnUP/teamteam_MMfsiG94K9Zy3e6w7Ccc9xY4, production deploymentdpl_Cx8GfP12KuFHcCgtnZ7SXxzt4AYZ/source5cc15c6a6189cfd56e127676bc5228e9ffd2ff56, with app.qidaigo.com and existing Vercel aliases. Authenticated admin health shows Primary/DR connectivity normal and replication observation stale. Public readonly smoke passed22actual checks; valid authenticated QR/staff/KDS flows are not inferred from these checks.

Fresh CodeQL analysis, complete same-source hosted acceptance, exact cloud cleanup/provider readback, protected deployment-evidence checks, staging-to-main provenance, Production/DR plans and live affected-flow verification remain required. Reviewed false-positive classifications must be tied to exact findings and source; no blanket dismissal. The OAuth secret's length check alone is not entropy proof. Missing formal configuration proof and real non-admin QA are distinct gaps, not passed tests. Incomplete AOCI indexing is not claimed as a complete source understanding and is excluded from this release commit.
