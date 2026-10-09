# Batch 2 deadline browser regression

This independent QA entry exercises the three actual read toolbars and the lazy complete editor. It injects controlled 429 responses, then performs real logout only for the exact isolated `awesome-b2-parity` actor. It does not issue catalog or approval mutations. Never use production credentials.

Run from the responsive worktree with its retained local Docker project and matching App at `http://127.0.0.1:3026`. Obtain the three synthetic passwords through the authorized local test credential channel; this file does not store them. Supply the expected product identity explicitly from the reviewed artifact. The harness refuses missing identity, wrong source/build/artifact, nonlocal DB/read targets, wrong Docker labels/ports and wrong frozen IDs. It never captures a candidate identity as an implicit fallback.

```powershell
$env:AWESOME_QA_EXPECTED_SOURCE_SHA256 = '73f13a02d7067b5c2ec64c125bc96c3e3114c032dc433e403896c90ea3b36ee9'
$env:AWESOME_QA_EXPECTED_BUILD_ID = '85AtKNFmbf1etY0d6DQCR'
$env:AWESOME_QA_OWNER_PASSWORD = '<authorized local synthetic owner password>'
$env:AWESOME_QA_ADMIN_PASSWORD = '<authorized local synthetic admin password>'
$env:AWESOME_QA_PARITY_PASSWORD = '<authorized local synthetic parity password>'
node docs/awesome-optimization/qa/deadline-browser.mjs
```

Output: `.superpowers/sdd/2026-10-01-awesome-optimization/batch-2/repair-1/checkedin-deadline-proof.json`, with harness SHA256, product identity, corpus digest, outcomes and run times. Preserve the prior receipt before a rerun. The harness closes all its browser contexts and leaves the active review App/Docker running. The parity session is logged out; no original frozen catalog/order/application rows are changed.

Repair round 1 adds actual live fixed-corpus, exact profile/role and parity-scope checks before browser launch. Every scoped operation binds the current cookie to the actual DB session, device, profile version, expiry, revocation and expected principal/context. Secure loopback cookies are selected by exact domain `127.0.0.1` and root path before that DB binding; token values are never recorded.

The five controls cover three real toolbars with manual and automatic focus/reconnect deadline blocking followed by successful revalidation after browser-clock advancement, mobile/desktop stable-ID keyboard return, and lazy editor deadline with real parity logout. Numeric and HTTP-date deadlines, recreated observer options and authority cancellation also have persistent actual QueryObserver tests in `src/lib/operations-query.test.ts`. Browser responses/visibility and time are controlled fault injection; the successful resumed read and logout use the real local backend. Live guard negative tests are executable with `node --test docs/awesome-optimization/qa/live-fixture-guard.test.mjs`; they use controlled read faults without altering frozen DB rows. Entry tests separately cover missing identity, wrong source, wrong build and wrong DB. Preserve their individual raw receipts rather than treating an earlier artifact as current. These local results do not constitute CI integration. B7 must include this harness or an equivalent checked-in wrapper in its trusted QA recipe and final test-input digest. The current product inventory excludes docs by the earlier inventory design; this separate harness has its own SHA256. Product changes require a new build and pair, and must never be concealed as harness-only changes.
