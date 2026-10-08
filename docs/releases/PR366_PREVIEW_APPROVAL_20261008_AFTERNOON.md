# PR366 replacement single Preview approval — 2026-10-08 afternoon

The human explicitly approved this replacement in this conversation. The preceding morning pair was used and cleaned; its approval cannot authorize another pair.

- One data-less Supabase child under `eyuctbnlvnbnivwasvqr`, paired with one Vercel Preview in project `prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP`, team `team_MMfsiG94K9Zy3e6w7Ccc9xY4`. Synthetic fixtures only, no new credentials or Production/DR writes under this validation scope.
- Incremental cost management target US$2, not a provider hard cap. No rebuild, additional pair or extension.
- Window: October 8 06:00–09:00 UTC (Taipei 14:00–17:00). Latest creation 07:45 UTC, requiring at least 75 minutes remaining. Cleanup starts ten minutes before expiry, no later than 08:50 UTC; success or failure triggers immediate exact cleanup and provider absence readback.
- Fresh candidate CI, Web scope, contract inventory and independent review must pass before creation. Preserve Preview required review and the same-head watcher bound to the exact source run. If gates miss latest creation, do not create resources.
- The existing exact five-item Web dependency exception retains its 15:30 UTC expiry and NON_PASS disposition. No CodeQL or Native waiver is added.

Morning source `37714174760` passed database, build and exact deployment binding, then failed at `CASH_SHIFT_BEFORE_READBACK`. Its screenshot shows the authenticated cash page with no open shift. The API returns `{state:{openShift},permissions}` but the harness read root-level `openShift`, rejecting the valid null state. Commit `ffcc4857e129ea4acfea347276a8ad31c1ce5fc3` fixes before/after extraction with malformed-response rejection; 54 focused tests and independent review passed. Other response envelopes and cash dialog labels were independently checked with no additional blocking mismatch; static checks do not prove hosted acceptance.

Morning final receipt is CLEANED: child `dpycdjndfulhcidrqfvg` absent from parent branch list, deployment `dpl_3R21t7wE3SuAi3DGDGF9DyvmQ89b` returns 404, watcher `37714196336` completed/cancelled. Primary alias remains on `dpl_Cx8GfP12KuFHcCgtnZ7SXxzt4AYZ`. Retain the failure and cleanup evidence. No afternoon resource exists yet; record fresh exact source/watcher/child/deployment IDs before operating them.
