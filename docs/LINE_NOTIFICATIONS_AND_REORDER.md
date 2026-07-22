# LINE 通知與再次點餐

## 範圍

本模組提供可選擇的 LINE 帳號綁定、訂單確認／可取餐／取消通知，以及以目前菜單重建購物車的再次點餐流程。顧客不需要登入 LINE 即可先完成 QR 點餐，LINE 授權只會在訂單成立後由顧客主動啟用。

## 資料與執行流程

1. `/order/:trackingToken` 透過 `manage-line-link` Edge Function 驗證 tracking token、裝置雜湊、rate limit、訂單與方案權限。
2. `START` 建立 10 分鐘、一次性的 OAuth state／nonce／PKCE session；資料庫只保存 state hash，原始 tracking token 與 code verifier 保存於 Supabase Vault。
3. `/api/public/line/callback` 交換授權碼並向 LINE 驗證 ID token、audience、nonce 與到期時間，成功後才建立 `customer_contact_links`。
4. 訂單進入 `CONFIRMED`、`READY` 或 `CANCELLED` 時，資料庫 trigger 以唯一鍵寫入 `notification_jobs`。訂單交易不直接呼叫 LINE。
5. Supabase `pg_cron` 每分鐘透過既有 Vault URL、Cron bearer 與 Vercel Protection bypass 呼叫 `/api/cron/notification-jobs`。工作採最多五次的指數退避；逾時的 `PROCESSING` lease 可重新領取。
6. `/api/webhooks/line/:integrationId` 在解析 JSON 前，以原始 request body 驗證 `x-line-signature`。事件只保存雜湊與類型；重複事件不會重做。`unfollow` 會撤銷同意並刪除 Vault recipient secret。
7. `/order/:trackingToken/reorder` 呼叫 `prepare-reorder`，重新查核商品、攤位供應、售罄、註記與目前價格。前端只預填購物車，後續仍建立新的 QR session、Turnstile token 與 idempotency key。

## 權限與方案

- `ORGANIZATION_OWNER`、`ORGANIZATION_ADMIN`、`STALL_MANAGER` 可管理 LINE 整合。
- `STAFF`、`KITCHEN`、`FINANCE_VIEWER` 不可讀取或修改 LINE 憑證設定。
- `LINE_NOTIFICATIONS` 與 `LINE_ORDER_LINKING`：Trial、Standard、Pro、Enterprise。
- `LINE_REPEAT_ORDER`：Trial（Staging QA）、Pro、Enterprise。
- 所有權限在 API、service 與 RLS 層執行，不只隱藏前端按鈕。

## LINE Console 設定

每個啟用的攤位需要已連結官方帳號的 Messaging API channel 與 LINE Login channel。

1. LINE Login callback URL：`https://staging.qidaigo.com/api/public/line/callback`。
2. 到攤位管理的「LINE 通知」輸入 LINE Login Channel ID、Messaging API Channel Access Token、Messaging API Channel Secret、LINE Login Channel Secret。
3. 儲存後複製畫面產生的 Webhook URL，貼入 Messaging API channel 並啟用 Webhook。
4. 憑證透過受 RBAC、CSRF、Origin validation 與 rate limit 保護的 API 寫入 Supabase Vault；瀏覽器、資料表、log 與 Git 都不保存明文。

正式環境需改用 `https://app.qidaigo.com/api/public/line/callback`，且必須使用 Production 專用 LINE channel 與 Vault secret，不得沿用 Staging 憑證。

## 安全控制

- OAuth state、nonce、PKCE S256、10 分鐘到期、單次 consume。
- Tracking token 與裝置 cookie 共同驗證，公開操作套用 IP／裝置／行為 rate limit。
- Provider user ID 只在 Vault 保存；公開資料表只保存 SHA-256 hash 與 Vault reference。
- Webhook 驗證原始 body 的 HMAC-SHA256 signature，限制 Content-Type、64 KB request 與事件數量。
- Notification failure 不回滾訂單建立、確認、完成或結帳。
- RLS 對所有新表啟用且 `FORCE ROW LEVEL SECURITY`；`anon` 沒有直接讀寫權限。
- 再次點餐不複製既有訂單，不採用舊價格，也不繞過 QR session、Turnstile 或伺服器計價。

實作依循 LINE 官方文件：[Webhook signature](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)、[Messaging API push](https://developers.line.biz/en/docs/messaging-api/sending-messages/)、[LINE Login PKCE](https://developers.line.biz/en/docs/line-login/integrate-pkce/) 與 [LINE Login API](https://developers.line.biz/en/reference/line-login/)。

## Staging 驗收

1. 以 owner／manager 登入，確認攤位管理可進入「LINE 通知」，KITCHEN 不可進入。
2. 使用 Staging 專用測試 channel 儲存設定，確認表格中只有 Vault reference，沒有明文 secret。
3. 建立測試訂單後啟用 LINE 通知，完成 OAuth，回到訂單頁應顯示「已連結」。
4. 依序確認訂單、標記可取餐、取消另一張測試訂單，確認工作佇列與通知內容。
5. 重新送出相同 webhook event，確認只處理一次；送出錯誤 signature 應回 `401`。
6. 點「再次點餐」，確認售罄商品被排除、價格變動顯示、註記變更要求重新確認。
7. 停止 LINE 通知後再次改變狀態，不得新增通知工作。

沒有 Staging LINE 測試 channel 憑證時，可完成所有自動化、權限與介面 QA，但無法驗收 LINE 平台實際送達。

## 回復

1. 在攤位設定停用整合；待送工作會取消，integration secret 會從 Vault 刪除。
2. 緊急停止 worker：`select cron.unschedule('stallorder-notification-jobs');`。
3. 緊急停止 OAuth cleanup：`select cron.unschedule('stallorder-line-link-session-cleanup');`。
4. 回復上一個 Vercel Staging deployment；資料表可保留，未啟用 integration 不會送出通知。
