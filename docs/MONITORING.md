# Logging 與 Monitoring

## 日誌來源

- Next.js `audit_logs`：登入、授權、CSRF、商戶控制、商品、狀態更新、取餐碼與現金結帳事件。
- Supabase `public_order_attempts`：session 發行、submission gate、Turnstile、建單與 tracking 拒絕／允許事件。
- Next.js 與 Edge stdout：單行 JSON，包含 `timestamp`／level、event、requestId 與不具敏感性的識別欄位。
- `GET /api/health`：向下相容的 Primary DB readiness；成功 200，失敗 503，不回傳例外或連線資訊。
- `GET /api/health/primary` 與 `/api/health/dr`：公開最小狀態；未設定 DR 時明確回傳 `UNKNOWN`，不假設健康。
- `GET /api/health/dependencies`：僅 Platform Admin 可讀的依賴明細；未授權者不執行探針。
- `GET /api/availability/config`：公開且無敏感資料的 active backend／promotion epoch／服務可用狀態，CDN 最長快取 2 秒。

API 回應的 `x-request-id` 可關聯應用日誌與資料庫安全事件。不得寫入 raw token、密碼、完整 IP、取餐碼、顧客電話或備註。

效能路徑使用 `src/lib/performance-timing.ts` 與 `supabase/functions/_shared/performance.ts` 輸出 `request_completed` 單行 JSON。允許欄位為 `route`、`requestId`、`status`、`totalMs`、`authMs`、`sessionMs`、`dbMs`、`dbQueryCount`、`edgeFunctionMs`、`turnstileMs`、`externalApiMs` 與 `renderMs`；未量到的欄位省略，不以總時間猜測。`Server-Timing` 供受控效能測試使用，但不得包含 tenant、stall、token 或個資。

`/staff/:stallSlug`、`/kitchen`、`/merchant/dashboard` 與
`/api/stalls/:stallSlug/kitchen/board` 均應輸出上述 timing。`dbQueryCount` 是程式宣告的
邏輯查詢數，用於偵測版本間回歸；實際資料庫 statement 數仍以 `pg_stat_statements`
或受控 tracing 為準。

Vercel 部署另外啟用 Analytics 與 Speed Insights。送出前必須經 `src/lib/performance-url-redaction.ts` 移除 capability token、stall 識別值、query string 與 hash；詳細檢查方式見 `docs/VERCEL_PERFORMANCE_OBSERVABILITY.md`。

## 必要指標與告警

- 5 分鐘 `INVALID_TURNSTILE`、`RATE_LIMITED`、`SESSION_REPLAYED` 或 `QR_SESSION_MISMATCH` 超過正常基線時告警。
- 同一 stall 的拒絕率超過 20%，或同一 IP／device hash 在 5 分鐘觸發 20 次拒絕時告警。
- 任一 `AUDIT_WRITE_FAILED`、`PUBLIC_ORDER_EDGE_FAILED`、`ORDER_SESSION_EDGE_FAILED` 或 `HEALTH_CHECK_FAILED` 立即告警。
- `/api/health` 連續三次非 200、Edge 5xx 比率超過 1%、P95 超過 1 秒時通知值班人員。
- Primary DB probe 超過 800 ms 標記 `DEGRADED`；2.5 秒未完成標記 `UNAVAILABLE`。
- `BACKEND_ACTIVE_TARGET=DR` 但 `DR_FAILOVER_ENABLED=false` 時，`/api/availability/config` 必須維持 `PRIMARY` 並回傳 `DEGRADED_SAFE`。
- `DR_HEALTH_CHECK_COMPLETED`、`DEPENDENCY_HEALTH_CHECK_COMPLETED` 或 `AVAILABILITY_CONFIG_RESOLUTION_FAILED` 出現非健康狀態時告警；不可把 `UNKNOWN` 當作成功證據。
- `/api/health` warm P75 超過 300 ms、order-session 超過 800 ms、order submission 超過 1.5 秒時告警；先分辨 `dbMs`、`turnstileMs` 與 `externalApiMs`，不要只看總時間。
- Staff／Kitchen list warm P75 超過 1 秒、Merchant dashboard 超過 1.5 秒或單次 `dbQueryCount` 非預期上升時告警。
- Runtime `DATABASE_CONNECTION_PROFILE` 任一必要布林值變為 false 時告警，但禁止輸出原始連線字串。
- 監控 PostgreSQL CPU、連線、磁碟、WAL、備份、cron 執行與 `public_rate_limit_buckets`／`auth_sessions` 資料量。
- 監控待確認訂單逾時率；異常升高通常表示攤位端離線或通知流程失效。
- `LINE_NOTIFICATION_FAILED` 會保留 structured log；不可重試或第五次失敗時建立 `LINE_NOTIFICATION_FAILURE` 營運警示。
- `notification_jobs` 的 `PROCESSING` 超過 10 分鐘視為失效 lease，worker 會改回可重試狀態。
- 最舊 `PENDING` 通知超過 5 分鐘時，檢查 `stallorder-notification-jobs` cron、Vault URL／Cron secret、Vercel Protection bypass 與 LINE API。

## 查詢範例

```sql
select reason_code, count(*)
from public.public_order_attempts
where created_at >= now() - interval '5 minutes'
  and outcome <> 'ALLOWED'
group by reason_code
order by count(*) desc;
```

```sql
select stall_id, count(*) filter (where outcome = 'DENIED') as denied,
       count(*) as total
from public.public_order_attempts
where created_at >= now() - interval '5 minutes'
group by stall_id;
```

上述查詢應由受信任的監控 service role 執行，不可暴露給匿名客戶端。

## 保存與維運

- `public_order_attempts` 預設保留 180 天；每分鐘逾時工作同時清除過期 rate-limit bucket 與超期事件。
- 商務 audit log 建議至少保存 180 天，實際期限依所在地法規與商戶合約設定。
- 日誌平台應限制維運人員權限、開啟靜態加密，並對查詢與匯出保留稽核紀錄。
- 每季演練：撤銷 QR、輪替 QR、關閉攤位、Turnstile 故障、資料庫故障、備份還原及 secret 輪替。
## 雙路徑公開訂單

結構化事件：

- `PUBLIC_ORDER_CIRCUIT_FALLBACK`
- `PUBLIC_ORDER_CIRCUIT_B_COMPLETED`
- `ORDER_SESSION_CIRCUIT_B_FAILED`
- `PUBLIC_ORDER_CIRCUIT_B_FAILED`
- `PUBLIC_ORDER_TRACKING_CIRCUIT_B_FAILED`

建議告警：

- 5 分鐘 fallback rate 超過公開訂單請求的 5%：warning
- 5 分鐘 fallback rate 超過 20%：critical
- Circuit B HTTP 5xx 連續 3 次：critical
- A、B 同時無法建立 session：critical
- idempotent replay 突增但 A transport timeout 同步增加：warning

只能記錄 operation、circuit、固定 reason code、status、request ID 與
latency。不得記錄 QR raw token、session／tracking token、Turnstile token、
pickup code、顧客電話、地址或備註。

## QR 降級與前台連線

- 監控 `QR_ORDERING_DEGRADED` 與 `QR_ORDERING_UNAVAILABLE` 的 503 比率；兩者
  是受控拒絕，不應觸發 Circuit A 與 Circuit B 之間的無效重試。
- `GET /api/availability/config` 的 `activeBackend` 或 `promotionEpoch` 改變時，
  QR 頁面必須建立新 session，不得沿用切換前 session。
- Staff 訂單看板應顯示 `SSE 即時`、`Realtime 備援`、`5 秒輪詢` 或
  `連線中`；任何備援模式持續超過 60 秒時告警。
- Service Worker 僅快取成功載入的公開菜單頁、公開菜單快照與穩定商品圖片。
  不得快取訂單 mutation、訂單追蹤、pickup code、付款或 authenticated
  response。
- 降級期間顧客只能查看菜單，畫面與伺服器都必須拒絕新 session／新訂單，
  且不得顯示假成功。

## 付款供應商狀態

- LINE Pay 與街口支付只接受明確的
  `AVAILABLE|DEGRADED|UNAVAILABLE|MAINTENANCE|UNKNOWN`。
- 功能未開啟時回傳 `MAINTENANCE`；功能開啟但缺少可信狀態時回傳
  `UNKNOWN`，不得把憑證存在視為健康。
- 只有 `AVAILABLE` 可建立新的線上付款；其他狀態保留現金／人工付款。
- 兩個線上供應商皆非 `AVAILABLE` 時發出營運告警，但不可因此阻止訂單建立。
- 現階段狀態不是實際付款探針。未來 Adapter 必須以簽章驗證、event
  idempotency 與查詢供應商結果更新狀態。

## DR 與 Storage

- DR 設定完成後，至少每分鐘呼叫受保護的
  `/api/cron/replication-health`，只保存已清理的狀態、lag、LSN 與
  schema 相容性。
- replication lag 超過 30 秒發出 warning；超過 5 分鐘或 worker
  disconnected 發出 critical。
- `replication_health_snapshots` 最新觀測超過 60 秒時，不得將報表導向
  DR。
- Storage manifest 維持 `PENDING`、`PROCESSING` 或 `FAILED` 超過 15 分鐘
  時告警；DR checksum 不一致不得標記 `MIRRORED`。
- 追蹤 `DATABASE_READ_ROUTED`、`DATABASE_DR_READ_FALLBACK`、
  `REPLICATION_HEALTH_CAPTURED`、`REPLICATION_HEALTH_CAPTURE_FAILED` 與
  `STORAGE_REPLICATION_FAILED`。
- 以上日誌不得包含資料庫 URL、Storage object path、Auth user ID、Email、
  provider 原始錯誤或任何 credential。

## 離線 POS

- 監控 `offline_order_sync_receipts` 的每分鐘匯入量、`DUPLICATE`、
  `REJECTED` 與 `ACCEPTED_WITH_CONFLICT` 比率。
- 待同步 queue age 超過 5 分鐘為 warning，超過 30 分鐘為 critical；需區分
  裝置尚未連線與 server import 失敗。
- 同一攤位 OPEN conflict 超過 5 筆、衝突率超過 10%，或
  `PAYMENT_RECONCILIATION_REQUIRED` 持續增加時通知店長。
- `OFFLINE_SYNC_DEVICE_INVALID`、`OFFLINE_SYNC_PERMIT_INVALID`、
  `OFFLINE_SYNC_PROTOCOL_UNSUPPORTED` 或 backend fencing 拒絕應建立安全告警。
- 現金班別出現 `SHIFT_ALREADY_CLOSED`、`CASH_TOTAL_MISMATCH` 或重複 movement
  時通知財務核對。
- `PRINT_STATUS_UNKNOWN` 不可自動重印，先轉營運警示。
- 追蹤本機 UI 顯示的待同步筆數、最舊資料分鐘數、Permit 到期與 storage class；
  Client 端錯誤只顯示固定代碼。
- 日誌不得包含 Permit、Session／CSRF token、完整 customer contact、備註、
  pickup code、付款 reference、資料庫 URL 或 provider credential。

## 統一 OAuth 與外送平台

### OAuth

- 追蹤 `OAUTH_LOGIN_STARTED`、`OAUTH_LOGIN_SUCCEEDED`、`OAUTH_LOGIN_FAILED`、
  `OAUTH_IDENTITY_LINKED`、`OAUTH_IDENTITY_UNLINKED`、`OAUTH_SESSION_REUSED` 與
  `OAUTH_PROVIDER_EVENT_REJECTED`。
- 同一 Provider 每 5 分鐘登入失敗超過 20 次或失敗率超過 20% 時告警；Apple
  Server-to-Server event 驗證失敗、Production 出現 Mock Provider，或已撤銷
  Identity 仍建立 Session 時一律視為 critical。
- callback 與 Mock authorize 路徑不得記錄 query string；平台 access log 亦應
  開啟 URL query redaction。

### 外送平台

- 追蹤 `DELIVERY_WEBHOOK_ACCEPTED`、`DELIVERY_WEBHOOK_REJECTED`、
  `DELIVERY_WEBHOOK_DUPLICATE`、`DELIVERY_JOB_RETRY_SCHEDULED`、
  `DELIVERY_JOB_SUCCEEDED`、`DELIVERY_JOB_DEAD_LETTER` 與
  `DELIVERY_ORDER_MAPPING_REQUIRED`。
- 同一 Provider 每分鐘 Webhook 驗證拒絕超過 5 次為 warning；重播比例在
  15 分鐘內超過 20%、任何 dead-letter job、Production 出現 Mock Connection，
  或跨組織／跨攤位 scope 驗證失敗均為 critical。
- `PENDING_RECONCILIATION` 超過 10 分鐘、待人工商品對應超過 5 筆，或同步工作
  連續 15 分鐘沒有成功紀錄時通知攤位管理者。
- 佇列重試採 1、5、15、60、360 分鐘退避；`PROCESSING` lease 逾時應回收，
  但不得建立第二筆相同 idempotency key 的工作。
- 日誌只記錄 Provider、固定錯誤分類、request ID、耗時與內部雜湊識別，不得
  記錄 OAuth code/state、Webhook signature、原始 payload、顧客姓名／電話／
  地址、外送員資料、Provider token、Client Secret 或完整外部訂單編號。
