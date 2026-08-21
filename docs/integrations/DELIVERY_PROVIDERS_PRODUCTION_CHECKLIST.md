# Delivery Providers Production Checklist

更新日期：2026-08-21

## 共用 Gate

- [x] Provider-neutral connection/store/event/order/job/audit foundation
- [x] Feature Flags 預設 OFF，native StallOrder ordering 不受影響
- [x] Tenant/store/connection isolation 與 durable replay controls
- [x] Bounded webhook、OAuth 與 API response streams
- [x] Fixed-origin request construction 與 redirect fail-closed
- [x] Unit regression、typecheck、lint、Prisma validate、production build
- [x] Staging-rebased baseline security scan 完成，2 項 finding 已有本分支修正與 regression tests（`25edc121-42f3-488d-a4f1-d421f3e01585`）
- [ ] 最終 branch HEAD locked re-scan 與 Draft PR CI 證據全綠
- [ ] Remote migration plan 在 Staging 套用並保留證據
- [ ] Staging smoke/E2E、queue/DLQ、observability 與 rollback drill
- [ ] 新 immutable Production Plan ID 與 plan-bound approval

## foodpanda readiness

- [x] Client credentials contract、order webhook authentication、order normalization、order fetch/status/history、item availability contract
- [ ] Partner app、Sandbox credentials、test chain/vendor/store mapping
- [ ] Live Sandbox webhook/order/action contract tests
- [ ] Catalog/menu/product capability（若 partner scope 核准）
- [ ] Pilot acceptance、rate-limit、retry、DLQ 與 reconciliation evidence

Verdict：`NOT READY`。

## Uber Eats readiness

- [x] Client credentials contract、authorize URL/PKCE inputs、raw-body HMAC/environment、resource order fetch、accept/deny/item suspension contract
- [ ] Authorization-code exchange、encrypted merchant token sink、store discovery/activation
- [ ] Partner app、Sandbox credentials、test store 與 required scopes
- [ ] Live Sandbox webhook/order/action contract tests與 Uber verification
- [ ] Menu/reports/reconciliation capability、pilot 與 operational evidence

Verdict：`NOT READY`。

## Release rule

Local PASS 不等於 Production Ready。必須依序完成 CI/Preview、Staging、DR/rollback evidence、Production Plan，最後才能在相同 immutable revision 上執行 Production Apply。任何 Gate=FAIL 都不得縮減測試或啟用 provider/write flags。
