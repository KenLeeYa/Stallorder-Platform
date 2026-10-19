# PR366 clean Linux proof routing

The owner approved minimal CI isolation, updating the existing PR366 head and one
standard Linux proof without Supabase/Vercel cloud resources at
2026-10-19T23:13:48Z (message Sentinel_1834404bbc148191b220d6154cf7d899).
This does not authorize full Preview, DR operations, merging, deployment, new
credentials/permissions, paid resources or restarting MSI Docker.

The required `verify` check retains its name and original regression steps. Its
clean `web-scope` prerequisite calls the existing Web proof as a reusable workflow
on a fresh ubuntu-latest runner. `verify` uses `always()` and explicitly fails
before regression when that prerequisite fails; skipped prerequisites cannot
become a successful required check. The old audit/build invocation was removed
from the job that exports local service keys, not waived. Credentials are neither
inherited by nor cleared inside the clean job; the credential guard is unchanged.

Both CI and proof checkout the explicit PR head SHA. Candidate evidence derives
the PR head from the runner event payload, retains the separate merge workflow
SHA for provenance, and requires the actual checkout to match. A dispatch/push
uses its actual workflow-ref SHA. No GitHub-provided SHA is overwritten. The audit
exception remains exact five HIGH, Web only, until 2026-10-22T14:00:00Z; all original
activation, artifact/SBOM/lint/isolation checks remain in force.

The existing default-branch-registered Ephemeral Preview workflow adds only
`operation=web-scope-proof`, restricted to workflow_dispatch, external approval
false and codex/integrated-production-20261002. It calls the same clean proof,
has a separate concurrency key, no Preview environment or inherited secrets and
does not enter validate/cleanup/provider jobs. This avoids relying on registration
of the standalone Web workflow on main. One approved invocation will use the new
immutable commit on the existing PR366 branch and preserve its uploaded evidence.

Before the non-force push, re-read PR366's old head94d2ad3a426959a865fcd0abd89d3a0ac35a43e2,
confirm ancestor relationship and the branch's git deploymentEnabled=false.
Do not create a new remote branch. PR synchronization also runs normal repository
CI/security workflows; the new manual route creates no cloud child or deployment.
The repository is public and uses standard hosted runners. Stop if an additional
paid resource is required. Preserve failed evidence; do not automatically rerun.

The Windows sharp/semver shim closure limitation is unchanged. Linux proof must
actually determine its own artifact outcome; no `.bin` files are ignored. Local
results and actual remote run links/receipts are stored outside the checkout after
the final commit, avoiding a self-referential candidate/evidence commit.
