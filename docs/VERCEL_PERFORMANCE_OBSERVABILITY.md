# Vercel 效能可觀測性

## 實作

Vercel 部署環境的 root layout 會掛載：

- `@vercel/analytics/next` 的 `Analytics`。
- `@vercel/speed-insights/next` 的 `SpeedInsights`。
- `src/lib/performance-url-redaction.ts` 的送出前去識別處理。

本機不掛載 Vercel 元件，避免開發與測試資料誤送。送出前會移除 query string 與 hash，並將 QR token、訂單 tracking token、邀請 token、stall slug 與 stall ID 替換為固定 route pattern。不得新增包含顧客姓名、電話、地址、備註、訂單內容、pickup code、session、付款資料或原始 token 的 custom analytics event。

## 儀表板

以 route、device 與 country 觀察：

- TTFB、FCP、LCP 與 INP。
- `/`、`/login`、`/onboarding`。
- `/q/:qrToken` 與 `/delivery/:stallSlug`。
- `/staff/:stallSlug`，其中廚房角色共用同一路由。
- `/merchant/dashboard` 與 `/merchant/reports/*`。

先以 P75 比較台灣 mobile 與 desktop，P95 用於長尾告警。少量 Internet sample 不直接阻擋 CI。

## 伺服器關聯

API 與 Edge 回應使用 `x-request-id`／`Server-Timing`；Vercel runtime 的 `request_completed` 事件包含固定 route、status、totalMs 及實際量到的 authMs、dbMs、edgeFunctionMs、turnstileMs 或 externalApiMs。分析時必須對齊同一時間窗的前端 RUM、Function duration、Supabase Edge 與 PostgreSQL 指標，不能從單一總時間猜測資料庫耗時。

## 發布檢查

1. 在 Preview 開啟 capability URL，確認 Analytics／Speed Insights request 不含原始 token、query string 或租戶識別值。
2. 確認 browser console 沒有 CSP 或 hydration 錯誤。
3. 確認 Vercel dashboard 能依去識別 route pattern 彙整指標。
4. Production 發布後至少觀察一個完整營業週期，再調整 cache TTL、告警或連線限制。
