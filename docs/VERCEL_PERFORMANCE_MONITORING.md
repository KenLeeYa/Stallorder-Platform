# Vercel Performance Monitoring

## 實作

Root layout 掛載：

- `@vercel/analytics/next` 的 `Analytics`。
- `@vercel/speed-insights/next` 的 `SpeedInsights`。
- `src/lib/performance-url-redaction.ts` 的 `beforeSend` 去識別。

送出前會將 `/q/<token>`、`/order/<token>`、`/invite/<token>` 替換成固定 route pattern，並移除所有 query string 與 hash。不得建立含 order ID、顧客電話、地址、備註、pickup code、session 或付款資訊的 custom analytics event。

## 儀表板

以 route、device、country 觀察：

- LCP、FCP、INP、TTFB。
- `/`、`/login`、`/onboarding`。
- `/q/:qrToken`。
- `/staff/:stallSlug`。
- `/merchant/dashboard`。

先以 P75 比較台灣／mobile 與 desktop；P95 用於告警與長尾追查，不直接以少量 Internet sample 阻擋 CI。

## Server-side correlation

API 與 Edge 回應包含 `x-request-id` 與 `Server-Timing`。Vercel logs 的 `request_completed` 事件包含固定 route、status、totalMs 及已量測的 authMs、dbMs、edgeFunctionMs、turnstileMs 或 externalApiMs。前端 RUM、Function duration、Supabase query statistics 必須以相同時間窗比較。

## 發布檢查

1. Preview 開啟頁面並確認 Analytics／Speed Insights request 沒有 raw capability token。
2. Vercel dashboard 能依 route pattern 顯示資料。
3. Browser console 沒有 CSP 阻擋。
4. 正式發布後至少觀察一個完整營業週期，再調整 cache TTL 或 connection limit。
