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
4. 憑證透過受 RBAC、CSRF、Origin validation 與 rate limit 保護的 API 寫入 Supabase Vault；表單編輯期間只暫存在目前頁面的記憶體，儲存後清空，不寫入瀏覽器持久儲存、一般資料表、log 或 Git。

正式環境需改用 `https://app.qidaigo.com/api/public/line/callback`，且必須使用 Production 專用 LINE channel 與 Vault secret，不得沿用 Staging 憑證。

## 商家首次設定引導（2026-09-08）

入口為「攤位管理 → LINE 訂單通知」。新設定預設從第一步開始；已有設定則直接顯示第四步的 Webhook 與實測說明，可按「修改串接設定」回到欄位。各步驟可直接切換，編輯草稿會保留到本次頁面離開為止。

| 步驟 | 商家操作 | 系統提供 |
| --- | --- | --- |
| 1 官方帳號 | 用自己的 OA 啟用 Messaging API，選擇 Provider，取得 Messaging API Token 與 Secret | 官方後台另開分頁、Provider 不可更換提醒、欄位取得位置及密碼輸入 |
| 2 LINE Login | 在同一 Provider 建立 Web app Channel、連結 OA、填入 Login ID／Secret 與 Callback URL | 依目前環境產生顧客用 `/api/public/line/callback`，一鍵複製及複製失敗時的手動選取 |
| 3 通知設定 | 填顯示名稱、OA 網址，選確認／取餐／取消通知並儲存 | 沿用既有權限與 Vault 寫入；欄位錯誤回到對應步驟，確認錯誤視窗後聚焦；網路失敗保留草稿供重試 |
| 4 Webhook 與實測 | 將攤位 Webhook 貼入 Messaging API，Verify 成功後啟用 Use webhook，再以顧客訂單完成授權及收訊測試 | 儲存後產生攤位 Webhook URL，提供好友、Channel 狀態、憑證、額度及原有 Webhook 衝突的排查說明 |

- 不需申請額外 Vault 帳號。更新設定仍依既有 UPSERT 合約要求三項憑證；可以重用有效原值，無須為了重填而在 LINE 重新簽發 Token。
- 本機／非 HTTPS 的環境會持續顯示 LINE 無法連入的說明；網址維持本環境值，不偷偷替換成正式站。公開 HTTPS 本身也不代表 LINE 已通過驗證。
- `ACTIVE` 代表設定已儲存及整合狀態開啟，介面會明示「尚未驗證實際收訊」。步驟位置不代表驗證成功，沒有自動勾選或假成功徽章。
- 本次未加入 LINE Channel 自動建立、憑證／Webhook 即時驗證、測試推播、Token 自動續期或 Module attach 授權；LINE 後台與真正收訊仍需依引導操作。OA 管理員建立及發布 Channel 的流程保留在 LINE。
- 現行顧客綁定以訂單為範圍，尚未建立跨訂單會員身分。本引導不會宣稱會員串接已完成。
- 每個 Channel 僅一個 Webhook URL；已有其他 CRM／機器人，或多攤位共用 OA 時，先確認既有整合設計，避免覆蓋其他服務。
- 桌機 1440、平板 768、手機 390／320 使用同一流程；步驟及主操作至少 48px，窄版兩欄步驟、單欄欄位，並保留既有未儲存離頁提醒。新引導字串具六種介面語系。

來源：[Messaging API 開始使用](https://developers.line.biz/en/docs/messaging-api/getting-started/)、[LINE Login 設定](https://developers.line.biz/en/docs/line-login/getting-started/)、[連結官方帳號](https://developers.line.biz/en/docs/line-login/link-a-bot/)、[Webhook 設定](https://developers.line.biz/en/docs/messaging-api/building-bot/)。

驗收：`QA-MER-11`；`e2e/line-setup-guide-local.spec.ts`（本機 loopback 限制，成功寫入回應及失敗使用 mock，無真實憑證或推播）、`e2e/line-notifications-and-reorder.spec.ts`（真實驗證 API 400／Kitchen 403、顧客入口與返回 Menu mock）、既有 LINE 合約／通知處理／OAuth／Callback 測試。上線狀態以相同 commit 的受保護發布證據為準；應用程式上線不代表商家的真實 LINE 收訊已驗收。

本機驗收結果：7 項引導案例與 2 項既有流程案例通過，包含停用取消／錯誤／成功回饋；8 個單元測試檔共 20 項通過。TypeScript、修改檔 ESLint、323 個 TSX 的 UI control audit、Production build 及變更內容的 Gitleaks 掃描皆通過。原始 checkout 的未提交 diff 指紋保持不變。

正式發布候選從已驗證的 `staging` 底版獨立整合本次引導；不包含其他本機介面、商品或訂單功能。發布底版的 9 項瀏覽器流程與完整 3,027 項單元測試通過（9 項既有條件式案例略過），並完成完整 lint、typecheck、UI audit、build、production guardrails 與零弱點套件 audit。測試 session 的期限與實際新登入相同，避免剛登入即觸發背景 session rotation。應用程式、資料庫結構、Edge Function 的差異分開檢查；本次無 migration 或 Edge 變更，可採既有 `production-application-release.yml` 的全新 Plan／Apply，先驗證未綁網域的產物，再升級網域並執行正式 smoke，失敗依原流程 rollback。

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
