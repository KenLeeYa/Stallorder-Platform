# QR 點餐降級模式

日期：2026-07-29

## 目的

當主要寫入端已封鎖、資料庫暫時不可寫，或平台管理員啟用
`EMERGENCY_QR_DEGRADED_MODE` 時，顧客仍可查看最近一次成功載入的公開菜單，
但系統不得接受新訂單或顯示假成功。

顧客提示固定為：

```text
目前線上送單暫時無法使用。您仍可查看菜單，請至攤位櫃台點餐。
```

## 狀態來源

公開頁面每 10 秒讀取 `GET /api/availability/config`，並使用：

- `qrOrdering`
- `activeBackend`
- `promotionEpoch`

`qrOrdering` 的處理方式：

| 狀態 | QR 行為 |
| --- | --- |
| `AVAILABLE` | 可建立新的短效 session 並送單 |
| `DEGRADED` | 保留菜單，只讀；新 session 與新訂單回傳 503 |
| `UNAVAILABLE` | 保留菜單，只讀；新 session 與新訂單回傳 503 |
| `MAINTENANCE`／`UNKNOWN` | 前端採保守處理，不允許送單 |

當 `activeBackend` 或 `promotionEpoch` 改變時，舊 session 不會被移轉到另一個
寫入目標。頁面會重新建立短效 session，避免跨 promotion epoch 寫入。

## 伺服器端閘門

Circuit A（Supabase Edge Function）與 Circuit B（Next.js trusted route）都會在
新增 session 或新增訂單前呼叫
`check_public_order_intake_availability(qr_token, device_id)`。

閘門檢查：

1. 當前 backend 必須允許寫入。
2. backend 必須是 `ACTIVE_WRITER`。
3. 依 Device、Stall、Organization、Global、Percentage 順序解析緊急降級旗標。
4. RPC 僅授權 `service_role`，`anon` 與 `authenticated` 不可直接執行。

未知 QR token 仍交由既有 QR 狀態、stall scope 與 session 驗證處理，避免新
閘門取代原本的安全判斷。

## 冪等與安全規則

- 已成功建立的 idempotency receipt 可重播原始成功結果。
- 已存在且仍有效的同裝置 session 可恢復。
- 降級期間禁止建立新的 session 或新訂單。
- 後端封鎖寫入時不新增 rate-limit 記錄；緊急降級時仍執行既有 rate limit。
- 價格、售罄、QR 狀態、Turnstile、session 一次性及 tenant/stall isolation
  仍由可信後端驗證。
- 前端狀態只負責體驗，不是授權依據。

## 離線菜單快取

Service Worker 對成功載入的 `/q/*` 與 `/delivery/*` HTML 採 network-first：

1. 網路成功時更新同網址快取。
2. 網路錯誤或 5xx 時顯示該網址最近成功的頁面。
3. 快取頁只能查看菜單；輸入、Turnstile 與送單控制停用。
4. 只有公開菜單、離線菜單快照與穩定商品圖片 API 可快取；訂單 mutation、
   訂單追蹤、付款、pickup code、session 與顧客資料不進入此快取。

這是單一瀏覽器的最近菜單快照，不是離線匿名訂單能力。

## 復原

當狀態恢復為 `AVAILABLE`：

1. 重新讀取 availability。
2. 建立新的 10 分鐘短效 session。
3. Turnstile 重新初始化。
4. 以新的 idempotency key 送出新訂單。

任何復原都不得把畫面中的購物車視為已成立訂單。

## 驗證

- pgTAP：旗標層級、過期 override、percentage、sealed backend、RPC grants。
- Vitest：Circuit A/B 降級、恢復 session、idempotency replay、availability
  parser。
- Playwright：菜單保留、控制停用、無 Turnstile、正式建置 Service Worker
  離線只讀。
