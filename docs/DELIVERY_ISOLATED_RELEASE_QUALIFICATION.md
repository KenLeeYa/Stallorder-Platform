# PR389 isolated delivery qualification control

Status: candidate installation; no Production release or delivery reopening.

The product stays frozen at b9a98a0bff0490c04b2295e4bcfb2b7781774c91 (tree feaf67bea32aa15ba0e67374b8aa4ff4307dc208). The separately reviewed control source must pass its own verify, validate, Vercel and security checks. Product evidence never substitutes for a control check.

The Preview workflow borrows only existing branch pr-389-oauth-delivery, project teunnvfakbfzmodajqjz, parent eyuctbnlvnbnivwasvqr, branch id e232885a-7d2e-4254-91f9-3a1edf9625e2 and Git branch codex/conversion-source-checks-20261023. It checks the live binding, healthy project state and data-less/nondefault flags before credentials or writes. One non-cancelling writer queue preserves ownership. The close handler retains this borrowed resource; only owned fixture cleanup runs. There is no create/delete fallback.

Connection parsing accepts PostgreSQL libpq's postgres and postgresql URI schemes, with the same exact project/API/user, region, port, database and connection-option restrictions. A rejected configuration exposes only a fixed diagnostic code, never its URL, key, password or assertion operands. Parent region metadata is not evidence of child region. The existing PR389 creation source 83fa10d84143f48371cc41edf4ac53b717c73246 requests ap-southeast-1; its live configuration must match that exact child region. A prior control incorrectly pinned the parent Tokyo region and was rejected before writes.

The product checkout, runtime, source bundle and deployment metadata remain distinct from the control checkout. Before DB fixtures and before deployment, exact source bytes and product identity are checked. Actual Vercel provider readback binds the product SHA, Preview project/team, branch, run and unique origin before Edge CORS updates. Control Vercel status comes from its own integration.

Exact product run 41907529661 passed verify with 112 dedicated checks, 203 E2E, 1,671 DB and 3,490 unit tests; raw source security failure remains 14 independently reviewed false positives with zero unresolved findings. Authenticated admission 41916050253 returned releaseAuthorized=false. Native recovery 41911701623 passed 146 to 147 to 146, stale/conflicting rollback rejection and owned cleanup. These do not prove hosted Preview, current Primary executor, Edge recovery, Production Plan/Apply or live affected-flow acceptance.

The store's delivery remains paused until the exact DB, five Edge functions and application release pass protected gates and live verification. Preserve pickup, dine-in, existing customer orders, unrelated source changes and carpool. No new resources, fees, credentials or denied-operation retries are authorized by this document.

CLI compatibility evidence: Supabase CLI v2.109.1 at immutable source 9d25ff8b5b0fba3c6f0ef000e7dd658c8d710c38, [branch-output tests](https://github.com/supabase/cli/blob/9d25ff8b5b0fba3c6f0ef000e7dd658c8d710c38/apps/cli-go/internal/branches/get/get_test.go), emits connect_timeout=10. The guard permits only that fixed value; zero, duplicates, arbitrary options and target overrides remain rejected.
