# 商家申請與商用架構稽核

## 稽核基準

- Repository：`KenLeeYa/Stallorder-Platform`
- 功能分支：`feature/merchant-application-commercial-management`
- 商用帳務基準：`feature/commercial-billing-phase1`（PR #5，`f31ca01`）
- 效能基準：`performance/cache-and-response-optimization`（已合併 `main`，`f9b475d`）
- 整合起點：`eb39343`，不包含 Staging 專用 CORS 提交

## 既有實作

### 身分與權限

- `src/app/auth/callback/route.ts` 僅接受已驗證 Google OAuth 身分，並將 `auth_user_id` 綁定至 `profiles`。
- `src/lib/auth.ts` 使用伺服器端 application session 與 CSRF token。
- `src/lib/authorization.ts`、`src/lib/rbac.ts` 已區分 Platform Admin、Organization 與 Stall 權限。
- `src/app/api/invitations/[token]/accept/route.ts` 已具備邀請接受與方案限制驗證。

### 舊 onboarding 行為

`src/app/api/onboarding/route.ts` 目前在單一 POST 內立即建立：

1. Organization
2. Trial Subscription
3. 第一個 Stall 與 ordering settings
4. QR Code（預設 ACTIVE）
5. 預設分類、商品與供應關聯
6. Organization Owner membership

此行為必須由「申請送出」移至 Platform Admin 核准交易。申請送出只能建立或更新 `merchant_applications`。

### 可直接重用的商用功能

- `plans`、`plan_versions`、`plan_entitlements`
- `subscriptions`、`subscription_items`
- `usage_events`、`billing_usage_summaries`
- `invoices`、`invoice_line_items`、`manual_payment_records`
- `src/server/billing/entitlement-service.ts`
- `src/server/billing/billing-workflow-service.ts`
- Merchant billing、usage、plans、invoice 頁面
- Platform Admin billing、subscription、invoice、payment 頁面
- 人工付款驗證、啟用、續約、停權、恢復
- fail-closed ECPay、NewebPay、電子發票 Adapter

以上功能不重建、不複製 migration；P0～P2 只建立申請、核准、設定與受控 Go-live 的前置生命週期。

## 缺少實作

- `merchant_applications` 與可信狀態轉換
- 申請者自己的狀態／補件頁面
- Platform Admin 申請列表與審核頁面
- 重複申請與規則式風險分類
- 交易式核准與 Trial provisioning
- `merchant_setup_progress`
- `orders.is_test` 與用量／營收排除
- 明確 Go-live 交易
- 申請與設定的 RLS、pgTAP、整合及 Playwright 測試

## P0～P2 不變條件

1. 申請送出不得建立 Organization、Stall、Subscription、QR 或商品。
2. 只有 `PENDING_REVIEW` 可由 Platform Admin 核准。
3. 核准交易必須一次建立 Organization、Owner、Trial、第一攤位、PAUSED QR 與 setup progress。
4. 核准後 Stall 必須是 `CLOSED` 且 `ordering_enabled=false`。
5. 完成一筆 `is_test=true` 的測試訂單前，Go-live 必須拒絕。
6. 測試訂單不得建立 billable usage，也不得進入一般營收報表。
7. 只有 Organization Owner 可執行 Go-live。
8. P3／P4 商用授權與帳務仍以 Organization 為正式授權單位。

## 授權矩陣

| 行為 | Applicant | Organization Owner | Staff / Kitchen | Platform Admin |
| --- | --- | --- | --- | --- |
| 建立／編輯自己的申請 | 是 | 僅無既有 membership 時 | 否 | 可檢視與審核 |
| 檢視其他申請 | 否 | 否 | 否 | 是 |
| 檢視 internal review note | 否 | 否 | 否 | 是 |
| 核准／拒絕／要求補件 | 否 | 否 | 否 | 是 |
| 執行設定精靈 | 否 | 是 | 否 | 否 |
| 建立設定測試訂單 | 否 | 是 | 否 | 否 |
| Go-live | 否 | 是 | 否 | 否 |
| 帳務與用量 | 否 | 完整 | 否 | 完整 |

## 權益矩陣

| 階段 | 商用狀態 | 可設定商家 | 可建立測試訂單 | 可公開接單 | 可計費 |
| --- | --- | --- | --- | --- | --- |
| 申請中 | 無 Organization | 否 | 否 | 否 | 否 |
| 已核准／設定中 | TRIALING | 是 | 是 | 否 | 測試訂單排除 |
| 已 Go-live | TRIALING / ACTIVE | 是 | 是 | 是 | 非測試完成訂單 |
| SUSPENDED | SUSPENDED | 唯讀／受限 | 否 | 否 | 保留歷史資料 |

## 安全與相依性

- 所有寫入維持 Trusted Origin、CSRF、Zod、rate limit、server-side authorization 與 Audit Log。
- 申請者身分只能由 application session 與 Google-linked `profiles.auth_user_id` 取得。
- 不接受 client 傳入的 applicant profile、Organization、reviewer、status、risk 或 entitlement。
- 新 exposed tables 啟用並強制 RLS；匿名角色不取得權限。
- QR Session、Turnstile、Idempotency 與 public order Edge Function 保持原設計。
