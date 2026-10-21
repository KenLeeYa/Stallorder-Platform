# PR366 single Preview approval — 2026-10-06

The user approved one additional PR366 hosted validation pair for **2026-10-06 01:00–04:00 UTC** (Taipei 09:00–12:00). This replaces the expired 2026-10-05 window; it does not authorize reuse of its failed runs or a second pair in this window.

- Scope: at most one data-less Supabase Micro child under Primary project `eyuctbnlvnbnivwasvqr` in `ap-southeast-1`, paired with one Preview deployment in existing Vercel project `prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP`. Use synthetic fixtures only. Do not mutate Production, Primary data or DR.
- Cost: US$2 is an operational stop target, not a provider-enforced invoice maximum. The user acknowledged actual billing may exceed it. Do not create an additional paid pair or assume unused prior budget.
- Time: reject capture before 01:00 UTC or with less than 75 minutes before 04:00 UTC; latest safe capture is 02:45 UTC. Delete exact owned resources immediately on failure or completion. The independent watcher begins deadline cleanup at 03:50 UTC; 04:00 UTC is absolute expiry. Verify provider absence and preserve receipts.
- Gates: push the exact window update, pass fresh head CI and Web Install Scope Proof, then dispatch exactly one manual `validate` and one same-head `deadline-cleanup-manual-run` bound to its source run ID. Both GitHub Preview jobs require designated reviewer approval. The source run must verify the watcher-ready artifact and active watcher before any paid creation. No approval bypass or new credential is authorized.
- Existing Web dependency risk exception `WEB-20261005-BRACES-USER-ACCEPTED` still expires at **2026-10-06 08:00 UTC**. The selected audit remains `NON_PASS` with the exact reviewed exception; this window approval does not extend it or waive any other gate. No merge or Production/DR deployment is authorized by this paid validation approval.

Prior 2026-10-05 runs `37281120509` (source) and `37281194800` (watcher) ended in failure after the review/receipt window elapsed. They are historical evidence, not permission to rerun or reuse their identity.
