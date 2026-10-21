# B3.1 independent task review

Reviewer: /root/responsive_b3a_review (gpt-6-astra high), read-only. Range add41d5401a7fe956efae1cd0eb6bb854e5856bf..484bf0267f856ec50d56ed21674e2968c0f1d075. Spec compliance: issues found. Task quality: Needs fixes. Critical: none.

## Strengths and evidence checked

Five frontend fixes are narrow and no API/RBAC/price/payment/provider contract changes found. Staff presentation709 cancels old rAF and functional ID ownership protects next selection; route test133 covers deferred frame. Accessibility spec40 uses real browser settings, DPR/innerWidth/pinch readback. Reviewer verified SHA256 of all14 role and6 native raw receipts, actual23PASS/4FAIL ->2PASS/2FAIL ->Staff2PASS chronology and16unitPASS. Physical/AT/human/exactChrome1280 remain permitted NOT_RUN; final build browser verification and B3.3 combined pending.

## Important 1 — fixed fixture QR identity ambiguity

e2e/helpers/responsive-acceptance-fixture.ts:34 selects ACTIVE QR using label only in unordered findFirstOrThrow. Lines56–57 create another ACTIVE QR with identical label for b3-fixed-locale. Later beforeAll can select the other stall and misbind returned stallId/settings/QR against existing120orders. Scope selection to expected organization/stall/QR identity and add reuse assertion with both QRs present. Named external check only: prisma/schema.prisma:2277 confirms ACTIVE default and no label uniqueness.

## Important 2 — operated controls and non-dialog keyboard gaps

e2e/responsive-accessibility.spec.ts:202 collects icon targets before configurator/detail interaction and silently excludes center-covered controls. Newly opened dialog controls and covered relevant icons cannot fail this check. Line262 only checks keyboard when dialog exists, leaving KDS/Admin and desktop Staff/Merchant focus visibility/order without current evidence. After actual operation check relevant controls' size and coverage; add Tab/Shift+Tab and keyboard activation for those non-dialog flows. These locally executable cases cannot be grouped under external-device NOT_RUN.

## Minor deferred to B3.3/final review

- b3-green-final.log:61 has3 real storefront SERVER_UNEXPECTED_ERROR events; navigation-abort root cause unproven. responsive-route-matrix.spec.ts:120 body/main/overflow alone cannot exclude partial streaming failure. Preserve and diagnose bounded actual storefront readiness/request-abort correlation in B3.3.
- b3-green-final.log:1 repeated NO_COLOR/FORCE_COLOR warning. Runner env can be normalized before future combined run; no product failure or rerun solely for warning.

Reviewer did not rerun suites, modify files or mutate runtime. Controller to resolve Important findings before next batch, preserve Minor items in final handoff.
