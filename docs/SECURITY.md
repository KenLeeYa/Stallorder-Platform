# StallOrder 安全基線

## 信任邊界

- 公開瀏覽器只能呼叫 `create-order-session`、`create-public-order` 與 `get-public-order` Edge Functions。
- `anon` 與 `authenticated` 對業務資料表均沒有直接寫入權限，也不能執行建單 RPC；所有寫入都必須經 Edge 或 Next.js 受信任後端。
- Edge Function 使用 service role 呼叫固定 RPC；service role key 不會傳到前端。
- 商戶／員工 Next.js API 使用伺服器端 Prisma、登入 session、RBAC、CSRF 與攤位範圍查詢。
- 所有 32 張公開業務表均啟用並強制 RLS。政策以 `auth.uid()` 對應 profile、organization membership 與 stall membership，平台管理員另有明確政策。

## QR 與公開訂單

- QR 伺服器狀態：`ACTIVE`、`PAUSED`、`EXPIRED`、`REVOKED`。
- 掃描靜態 QR 後才建立短效 session；預設 600 秒，只保存 SHA-256 token hash，並綁定 tenant、stall、QR、裝置與來源 IP hash。
- 成功建單會在同一交易將 session 設為 `CONSUMED`。相同冪等鍵可安全取回既有結果；不同冪等鍵重播會被拒絕。
- 三支 Edge Function 入口先以 IP、裝置與行為雜湊執行全域 gate，避免未知 token 無界請求；取得有效 stall/session 後，再執行 IP、裝置、QR、session、攤位與行為雜湊六維 gate，成功建單交易另有第二層限流。
- Turnstile token 固定送往 Cloudflare Siteverify，檢查 success、五分鐘期限、單次使用結果、hostname 與 `public_order` action。網路錯誤採 fail closed。
- Cloudflare 官方測試金鑰只有在 `TURNSTILE_ALLOW_TEST_KEYS=true`、secret 精確吻合且 Siteverify 回傳 testing metadata 時才可略過測試回應缺少的 action／hostname。
- 伺服器重新查詢商品、供應狀態與價格，並套用單品數量、商品種類、總數量、備註、每裝置待確認與時間窗限制。

## 訂單狀態與取餐

狀態只能依序推進：

`WAITING_CONFIRMATION → CONFIRMED → PREPARING → READY → COMPLETED`

待確認訂單不會出現在廚房角色的看板，且不能直接進入製作。pg_cron 每分鐘執行逾時工作，將超過攤位設定期限的待確認訂單改為 `EXPIRED`。QR 訂單在現金結帳完成前必須驗證六位取餐碼；資料庫只保存取餐碼 SHA-256。

## 登入、Session 與 CSRF

- 密碼至少 12 個字元，bcrypt cost 12；不存在帳號也執行 dummy hash 比對。
- 登入受 IP 及 IP+帳號雙維限流。停用帳號、停權 tenant 或停用 stall membership 均無法登入或授權。
- 登入 session 使用 256-bit 隨機 token，資料庫只保存 SHA-256，有效期固定八小時。
- Session Cookie 為 `HttpOnly`、`SameSite=Lax`，正式環境加 `Secure`；登出會刪除伺服器 session。
- 已登入寫入同時驗證同源 Origin、double-submit CSRF cookie/header，以及 session 綁定的 CSRF token hash。

## RBAC

- `PLATFORM_ADMIN`：跨租戶平台維運與額外攤位核准，不能由商戶邀請授予。
- `ORGANIZATION_OWNER`：組織、所有攤位、共用商品、財務、人員、訂閱與帳務。
- `ORGANIZATION_ADMIN`：依 `all_stalls` 與攤位指派管理營運，不可管理 subscription。
- `FINANCE_VIEWER`：授權範圍財務/報表唯讀，不可更新訂單、商品、人員或攤位。
- `STALL_MANAGER`：指定攤位商品、點餐、員工、訂單、結帳與攤位報表。
- `STAFF`：指定攤位接單、狀態更新、取消防呆、取餐碼驗證與現金結帳。
- `KITCHEN`：指定攤位只看已確認訂單，僅能推進 `PREPARING/READY`，不可讀財務。
- `MERCHANT_OWNER/MERCHANT_MANAGER` 僅保留 enum migration 相容性，不授予新流程權限。

所有物件查詢同時加入伺服器解析出的 organization/stall scope；跨組織或未授權跨攤位物件以 404、403 或空結果處理。Client role、URL、localStorage 與 Google metadata 均不作授權證據。

## OWASP Top 10 對應

- A01 Broken Access Control：全表 RLS、RBAC、物件層 stall 條件、anon 零寫入、跨裝置 tracking 綁定。
- A02 Cryptographic Failures：高熵 token、SHA-256／HMAC 雜湊、獨立 secrets、Secure Cookie、HSTS。
- A03 Injection：Zod、結構化 JSON、Prisma 參數化查詢與固定 SQL RPC。
- A04 Insecure Design：一次性 session、Turnstile、多維限流、伺服器價格、確認前不製作、逾時與緊急停止。
- A05 Security Misconfiguration：嚴格 CORS、CSP、安全 headers、正式測試金鑰禁用、最小資料庫 grant。
- A06 Vulnerable Components：lockfile、`npm audit` 與 CI build/test；依賴更新需先通過安全測試。
- A07 Authentication Failures：bcrypt、統一錯誤、雙維登入限流、session 到期與帳號／tenant 停用檢查。
- A08 Software and Data Integrity Failures：版本化 migrations、冪等鍵、狀態條件式原子更新、不可跳躍狀態機。
- A09 Logging and Monitoring Failures：audit log、`public_order_attempts`、request ID、JSON stdout、健康檢查與告警基線。
- A10 SSRF：Siteverify URL 寫死且不接受使用者 URL；API 不提供任意遠端抓取能力。

## Secrets 與資料保護

不得記錄密碼、session／CSRF／QR raw token、Turnstile token、service role key、完整 IP、顧客備註或取餐碼。IP 與裝置識別使用環境專屬 HMAC secret；不同環境不得共用。正式資料庫備份、還原演練、金鑰輪替與刪除政策由部署平台負責。
