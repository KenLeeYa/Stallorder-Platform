# 商家申請架構

## 狀態機

```text
DRAFT -> SUBMITTED -> PENDING_REVIEW
NEEDS_INFO -> SUBMITTED -> PENDING_REVIEW
PENDING_REVIEW -> NEEDS_INFO | APPROVED | REJECTED | WITHDRAWN
DRAFT | SUBMITTED | PENDING_REVIEW | NEEDS_INFO -> WITHDRAWN
DRAFT | NEEDS_INFO -> EXPIRED
APPROVED | REJECTED | WITHDRAWN | EXPIRED -> terminal
```

- Applicant 只能儲存自己的 DRAFT、提交 DRAFT／NEEDS_INFO，以及撤回自己的非 terminal 申請。
- Platform Admin 只能透過 trusted review service 執行補件、核准、拒絕或代為撤回。
- Client 不可直接傳入或更新 `status`、`risk_level`、reviewer、approved organization 或 internal note。

## 登入後目的地

1. 有有效邀請：先進入 invitation acceptance。
2. 有 Organization／Stall membership：既有工作區或 `/select-organization`。
3. APPROVED 且 setup 未完成：`/merchant/setup`。
4. NEEDS_INFO：`/onboarding/edit`。
5. SUBMITTED／PENDING_REVIEW：`/onboarding/status`。
6. DRAFT 或無申請：`/onboarding`。

## 申請與核准邊界

- `/api/onboarding` 只建立或更新 `merchant_applications`。
- `/api/admin/merchant-applications/:id` 執行受控 review transition。
- 核准委派給 `approveMerchantApplication`，且整個 provisioning 在 Serializable transaction 完成。
- Trial 解析使用有效且不可變的 `plan_version_id`，不以 UI 方案名稱授權。

## 核准初始狀態

```text
Organization.status = TRIALING
Subscription.status = TRIALING
Stall.is_active = true
Stall.business_status = CLOSED
Stall.ordering_state = CLOSED
Stall.ordering_enabled = false
QrCode.state = PAUSED
```

## 設定與 Go-live

- 設定精靈進度儲存在 `merchant_setup_progress`。
- 測試訂單標記 `orders.is_test=true`，可由既有 Staff order board 處理狀態。
- Go-live 同時驗證完成的測試訂單、Trial／Subscription 狀態與 Owner 權限。
- Go-live transaction 才能把 QR 切為 ACTIVE 並把 Stall 切為 OPEN。

## 商用整合

- 核准建立的 Trial Subscription 直接使用既有 Plan Version、Entitlement 與 Usage Engine。
- 測試訂單由 database trigger 排除，不產生 `BILLABLE_ORDER_COMPLETED`。
- Go-live 後的非測試完成訂單依既有 Trial hard limit 或 paid soft limit 執行。
- Invoice、manual payment、activation、suspension 與 reactivation 沿用 PR #5，沒有第二套狀態來源。

## 2026-10-01 本機候選：草稿版本與表單

- SAVE_DRAFT／SUBMIT 必須提交 applicationId 與 expectedDraftVersion；首次建立限定 null／0。接受的儲存與內容／可編輯性變更皆原子遞增，既有過期 SQL 函式也遞增。舊版本回409，保留輸入，讀取本人目前草稿後明確載入或勾選差異。
- 既有四步表單採 RHF7.89.0／Zod4；有效編輯750ms 自動儲存，單一請求與最新待存快照。下一步與送出等候確認版本。離線顯示未儲存警告，無共享 localStorage 草稿。
- NEEDS_INFO 保留公開補件說明與同一申請 ID、顯示本次差異。送出逾時透過本人 GET 確認原申請；核准仍由原交易建立 CLOSED 攤位、PAUSED QR，Owner 完成既有設定／測試訂單才可明確 Go-live。
- 現行沒有附件上傳 consumer；AW19 附件與外部表單維持 unavailable／DEFERRED_GATE，未加入上傳或商用外部表單套件。
- 本段為未提交本機候選；不表示远端遷移、真實 OAuth、實體裝置或正式環境已驗證。具體 scoped QA／審核狀態以 Batch3 報告為準。
