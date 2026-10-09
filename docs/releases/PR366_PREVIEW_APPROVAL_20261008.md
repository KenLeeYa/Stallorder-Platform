# PR366 single replacement Preview approval — 2026-10-08

The human explicitly approved this window in this conversation after the previous two single pairs were used and cleaned. The expired October 7 proposal is not executable authorization.

- One data-less Supabase child under `eyuctbnlvnbnivwasvqr`, paired with one Vercel Preview in project `prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP`, team `team_MMfsiG94K9Zy3e6w7Ccc9xY4`. Synthetic fixtures only; no new credential or Production/DR write under this validation scope.
- Incremental cost stop target US$2, not a provider hard cap. No additional pair, automatic rebuild or extension.
- Window: October 8 02:00–05:00 UTC (Taipei 10:00–13:00). Earliest capture 02:00; latest capture 03:45, with at least 75 minutes remaining. Cleanup begins ten minutes before expiry, no later than 04:50 UTC. Success or failure triggers immediate exact-resource cleanup and provider absence readback.
- Fresh exact-head full CI and Web scope must pass before paid creation. Keep the Preview required reviewer and independent same-head deadline watcher bound to the precise source run. If gates cannot finish before latest capture, do not create resources.
- The existing exact Web braces exception still expires October 8 15:30 UTC. This approval neither renews it nor accepts CodeQL or Native findings. Audit remains NON_PASS.

Candidate `924b93c6` passed CI `37657977316` (4515 unit tests, 1688 SQL assertions, 234 browser tests, 8 resilience tests; 106 unit and 64 browser skips remain separate) and Web scope `37657977121`. CodeQL `112919210772` remains FAILURE, 16 failure and 6 warning annotations.

The second pair `37653430865` passed database, build and deployment binding but failed STAFF_PASSWORD_LOGIN; its child and deployment were cleaned and independently read back absent. The new bounded HTTP/redirect harness passed 60 focused regressions and independent review. The delayed loopback Chromium regression demonstrates the old five-second waiting mechanism, not the cloud root cause or hosted acceptance. This replacement must prove the actual hosted flows before release.

Only the five deadline guard/workflow/test files change after `924b93c6`; no application, lockfile, credentials or runtime security boundary changes. Historical receipts remain historical. Record the new exact commit, source run, watcher, child and deployment before operating them.

## New registry finding and compatible repair

Web scope `37710524189` failed `WEB_AUDIT_EXCEPTION_UNREVIEWED`: the fresh registry audit added six Next.js advisories to the previous graph. This failure is not waived. The [official Image Optimization advisory](https://github.com/advisories/GHSA-cjq9-62q9-8jv4) identifies 16.3.8 as patched; official npm metadata confirms its availability. Update only Next 16.3.6 to 16.3.8 and its matched env/SWC packages. Keep eslint-config-next and all five reviewed development dependency versions unchanged.

Fresh selected audit returns exactly the original five high entries, zero critical and no additional advisory. The existing strict `assertRootAudit` verifies package names, versions, nodes, via, effects, ranges and counts before rebinding only the parsed-lock hash to `00f3c2b4363f58e2485fb9139142ac9d611671ad04e8561150cf35be8015bc6c`. No validator is weakened, expiry renewed or risk scope expanded; disposition remains NON_PASS. Independent source review confirms the narrow package/lock/policy diff. Fresh exact-head CI, installed build and hosted affected-flow QA remain required after this repair; previous CI does not prove the patched runtime.
