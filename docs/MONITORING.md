# Logging 與 Monitoring

## 日誌來源

- Next.js `audit_logs`：登入、授權、CSRF、商戶控制、商品、狀態更新、取餐碼與現金結帳事件。
- Supabase `public_order_attempts`：session 發行、submission gate、Turnstile、建單與 tracking 拒絕／允許事件。
- Next.js 與 Edge stdout：單行 JSON，包含 `timestamp`／level、event、requestId 與不具敏感性的識別欄位。
- `GET /api/health`：最小資料庫查詢；成功 200，失敗 503，不回傳例外或連線資訊。

API 回應的 `x-request-id` 可關聯應用日誌與資料庫安全事件。不得寫入 raw token、密碼、完整 IP、取餐碼、顧客電話或備註。

## 效能計時

`src/lib/performance-timing.ts` 與 `supabase/functions/_shared/performance.ts` 只記錄固定 route 名稱、request ID、HTTP status 與可量測耗時：`totalMs`、`authMs`、`dbMs`、`dbConnectMs`、`edgeFunctionMs`、`turnstileMs`、`renderMs`、`externalApiMs`。回應另提供相同分類的 `Server-Timing`。

目前至少涵蓋 health、login、merchant dashboard、staff order list、公開 QR session、公開建單、公開訂單追蹤與 checkout。所有計時均在 `finally`／完成路徑收斂，不得把 token、URL query、request body 或客戶欄位加入 performance fields。

建議 warning threshold：health 300 ms、order session 800 ms、staff list 1,000 ms、dashboard／order submit 1,500 ms；5xx 一律以 error level。`DATABASE_CONNECTION_PROFILE` 只能輸出 pooler 設定的布林狀態，禁止輸出連線字串。

## 必要指標與告警

- 5 分鐘 `INVALID_TURNSTILE`、`RATE_LIMITED`、`SESSION_REPLAYED` 或 `QR_SESSION_MISMATCH` 超過正常基線時告警。
- 同一 stall 的拒絕率超過 20%，或同一 IP／device hash 在 5 分鐘觸發 20 次拒絕時告警。
- 任一 `AUDIT_WRITE_FAILED`、`PUBLIC_ORDER_EDGE_FAILED`、`ORDER_SESSION_EDGE_FAILED` 或 `HEALTH_CHECK_FAILED` 立即告警。
- `/api/health` 連續三次非 200、Edge 5xx 比率超過 1%、P95 超過 1 秒時通知值班人員。
- 監控 PostgreSQL CPU、連線、磁碟、WAL、備份、cron 執行與 `public_rate_limit_buckets`／`auth_sessions` 資料量。
- 監控待確認訂單逾時率；異常升高通常表示攤位端離線或通知流程失效。

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
