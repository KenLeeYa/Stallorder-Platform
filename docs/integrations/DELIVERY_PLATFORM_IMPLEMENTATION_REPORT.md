# foodpanda 與 Uber Eats 整合實作報告

更新日期：2026-08-21

## 結論

本次完成可在本機驗證的 provider contract、token/client、webhook、訂單正規化、connection-scoped idempotency、ORDER_FETCH 工作與細粒度 Feature Flag。所有新 Flag 預設為 `false`。

目前 verdict：`NOT READY`。程式可安全地以 disabled deployment 方式進入 CI/Preview；尚未具備 Sandbox credential、partner approval、live Sandbox E2E、Uber merchant token sink 與 Production cutover 證據，因此不得啟用正式流量。

## 已完成

- foodpanda：client credentials token、固定 sandbox/production origin、Authorization webhook 驗證、完整訂單正規化、單筆訂單讀取、狀態更新、vendor order history、商品可售狀態更新。
- Uber Eats：client credentials token、OAuth authorize URL + PKCE/state 輸入、raw-body HMAC、`X-Environment`、webhook resource reference 後續抓單、訂單讀取、accept、deny、單品 suspension。
- 共用：timeout、單次 401 refresh、incremental bounded response reader、3xx fail-closed、SSRF path/origin 限制、secret reference allowlist、金額精確轉換、durable webhook、queue/DLQ、connection-scoped unique keys、稽核與預設關閉的 Feature Flag。
- Canonical webhook：`POST /api/integrations/foodpanda/webhooks/orders` 與 `POST /api/integrations/ubereats/webhook`，成功回空 body `200`。

## 最終本機驗證

- Focused security regression：7 files / 33 tests PASS。
- Full Vitest：314 files PASS、2 skipped；1930 tests PASS、9 skipped。
- `npm run typecheck`、`npm run lint`、`npm run prisma:validate`、`npm run build`：PASS。
- OAuth 307 與 provider mutation 307 two-origin PoC：皆回 `PROVIDER_CONTRACT_ERROR`，第二 origin 命中數為 0。
- Locked security diff scan `56bd9b18-ecd4-41d4-a899-d47d08e8ffb4`：coverage complete、324/324 rows closed、0 candidates、0 findings。
- `npm run production:check`：PASS；`.env.example`、delivery migration 與 credential guardrails 均通過。

## 尚未完成或需外部依賴

- Uber authorization-code exchange、加密 token sink、store discovery/activation。
- foodpanda catalog read/full menu sync/product creation beta；Uber menu read/full upload、ready-time generation、store/holiday/reports、reconciliation。
- provider Sandbox/Production credentials、portal webhook 設定、正式 scope/partner approval。
- Sandbox E2E、Uber verification、pilot、Production Plan/Apply。
- token cache 目前為單一 process 內 single-flight；多實例 shared cache 尚未實作。

## Gate

- Local unit/type/build/security gate：PASS。
- Sandbox gate：FAIL，缺 provider credential、test store 與 live E2E。
- Production gate：FAIL。不得啟用 flags、不得執行 migration Apply 或 Production Apply。

詳細手動項目見：

- [foodpanda manual actions](foodpanda/FOODPANDA_MANUAL_ACTIONS.md)
- [Uber Eats manual actions](ubereats/UBEREATS_MANUAL_ACTIONS.md)
