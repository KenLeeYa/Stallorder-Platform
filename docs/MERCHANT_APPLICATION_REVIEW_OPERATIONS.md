# 商家申請審核操作

## 角色與入口

- 只有 `PLATFORM_ADMIN` 可進入 `/admin/merchant-applications` 與申請明細。
- 申請者只能在 `/onboarding/status` 查看公開狀態與 `public_review_note`。
- `internal_review_note`、風險原因與來源雜湊只供受信任的審核服務使用。

## 審核流程

1. 依待審核、補件、風險、重複資料、未指派與送件時間篩選。
2. 指派有效的 Platform Admin reviewer。
3. 檢查 Google-linked profile、申請完整度、重複 email／phone／registration／slug 與風險原因。
4. 資料不足時選擇「要求補件」，只在公開說明放申請者需要知道的內容。
5. 風險不可接受時拒絕或封鎖來源；缺少非必填統一編號不得單獨成為拒絕理由。
6. 符合條件時核准。核准會在 Serializable transaction 內建立 Trial 工作區，不會直接開放 QR。

## 核准後檢查

必須同時成立：

```text
Organization = TRIALING
Subscription = TRIALING，且綁定有效 Trial Plan Version
Owner membership = 1
Stall = CLOSED，ordering_enabled = false
QR = PAUSED
merchant_setup_progress.go_live_completed = false
```

重送同一核准操作會回傳既有 Organization，不得建立第二組資源。Slug 或 membership 發生競爭衝突時，整筆交易回復。

## 稽核與異常

- 指派、內部註記、補件、風險、封鎖、拒絕、核准與代撤回都寫入 `audit_logs`。
- 不把電話、申請內容、session、CSRF、IP 原文或資料庫錯誤寫入應用 log。
- 若 provisioning 失敗，先依 request ID 查應用與資料庫 log；不要手動補建部分 Organization。
- 修正資料後由審核頁重試 trusted approval service。

## Phase 1 限制

- 全部申請人工審核。
- 不自動寄 Email；通知只寫入站內 application notification。
- 不啟用 ECPay、NewebPay 或電子發票。
