# 雙路徑公開訂單接收

## 狀態

- 實作階段：P2
- 預設狀態：關閉
- 控制旗標：`DUAL_ORDER_INTAKE_ENABLED`
- 寫入後端：目前固定為 Primary
- DR 寫入：尚未開放，須等待 fencing、promotion epoch 與 P6 演練完成

本階段不改變既有公開 URL，也不允許匿名資料庫寫入。

## 路徑

Circuit A：

```text
瀏覽器
-> Supabase Edge Function
-> 受信任 PostgreSQL RPC
-> Primary
```

Circuit B：

```text
瀏覽器
-> Vercel Next.js Route Handler
-> 同一組受信任 PostgreSQL RPC
-> Primary
```

Circuit B 路由：

- `POST /api/public/order-session`
- `POST /api/public/orders`
- `GET /api/public/orders/:trackingToken`

## 一致性與防重

瀏覽器在兩次嘗試間保持完全相同的：

- `sessionRequestId`
- `idempotencyKey`
- `clientOrderId`
- `turnstileIdempotencyKey`
- `orderSessionToken`
- `deviceId`

`sessionRequestId`、QR token 與 device ID 由伺服器密鑰推導出相同的
opaque session token。Migration
`20260729173000_idempotent_dual_order_intake.sql` 使用交易級 advisory lock，
確保 A/B 同時首送也只建立一筆 session。

訂單仍由既有 `create_public_order_with_schedule` 或
`create_public_delivery_order_with_schedule` RPC 執行。商品狀態、註記、
數量、方案額度與價格都以資料庫當下狀態重新驗證和計算。

## 安全控制

兩條路徑共同使用：

- 32 KB bounded JSON 與嚴格 Zod schema
- 同站 Origin 驗證與協定版本檢查
- 受信任的 Vercel client IP
- QR／攤位／行程狀態驗證
- 10 分鐘短效、單次使用且綁定 device 的 session
- Cloudflare Turnstile 伺服器端驗證
- IP、device、QR、session、stall 與 behavior 限流
- 方案與用量限制
- PostgreSQL 端商品、註記、數量與價格驗證
- idempotency 與 `public_order_attempts` 紀錄

新 RPC 已撤銷 `public`、`anon`、`authenticated` 執行權，只授權
`service_role`。瀏覽器無法直接寫入 orders 或 order_sessions。

## 斷路器

`src/lib/public-order-circuit-breaker.ts` 的狀態為：

```text
CLOSED -> OPEN -> HALF_OPEN -> CLOSED
```

- 連續 2 次基礎設施失敗後開啟。
- 10 秒冷卻後只允許 1 次 half-open 探測。
- 僅在旗標針對該 device 生效時切換至 Circuit B。
- B 路徑本身也再次由後端驗證同一旗標。

允許切換：

- fetch／連線失敗
- timeout
- HTTP 408
- 未被辨識為業務拒絕的 HTTP 5xx

禁止切換：

- 429 rate limit
- Turnstile 失敗或不可用
- session 已使用、過期或裝置不符
- QR、攤位、商品、註記、數量或方案限制
- 其他 4xx 業務拒絕

## 漸進開啟

1. 保持全域預設關閉。
2. 在隔離 Preview 以 device scope 開啟。
3. 驗證 A 失敗時 B 成功且只有一筆 session／order。
4. 以 percentage scope 小比例開啟並監控 fallback rate。
5. 擴大前確認 Turnstile、rate limit、訂單總額和稽核紀錄一致。

禁止在未完成 P3/P6 前把 `BACKEND_ACTIVE_TARGET` 指向 DR。

## 回復

立即將 `DUAL_ORDER_INTAKE_ENABLED` 設為 false。客戶端回到既有 Circuit A
或 Preview 同站 Edge proxy；B 路徑即使被直接呼叫也回傳 503，不執行訂單
邏輯。Migration 可保留，因為它向下相容且不改變舊 RPC。

如必須移除新 RPC：

```sql
drop function if exists public.issue_idempotent_order_session_with_schedule(
  text, text, text, text, text, text, text, text
);
```

先關閉旗標並確認沒有新版客戶端流量後才可執行。

## 驗證證據

- TypeScript typecheck
- Vitest：斷路器、業務拒絕不切換、相同 payload、API 邊界、Turnstile
  失敗與 idempotent replay
- pgTAP：RPC grant 與同一 session 僅建立一次
- 本機完整 migration reset

正式環境只可先做 read-only smoke test；送出測試訂單必須使用明確核准的
測試攤位。
