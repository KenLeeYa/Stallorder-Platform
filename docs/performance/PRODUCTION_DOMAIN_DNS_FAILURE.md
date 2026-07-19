# StallOrder 效能基準

- 量測時間：2026-07-18T22:18:53.595Z
- 階段：production-domain-dns-failure
- 版本：d62dd89f6760285f34ce41306263c16256459183
- Function region：iad1
- 目標來源：https://app.qidaigo.com
- 每條路由要求數：3（第一筆為 cold-like，其餘為 warm）
- 驗證狀態：未登入
- 隱私：未保存回應本文、Cookie、密碼、Session 或原始 QR Token。

> cold-like 是帶 `Cache-Control: no-cache` 的第一筆要求，不代表一定觸發 Vercel Function 真正冷啟動。Android 數據為 80ms RTT、4 Mbps 下載的合成網路。

## HTTP 結果

| 路由 | 狀態 | Cold DNS | Cold TCP | Cold TLS | Cold TTFB | Cold 總時間 | Warm TTFB P75 | Warm 總時間 P75 | 回應大小 | Cache | Edge PoP |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| / | - | - | - | - | - | - | - | - | - | - | - |
| /login | - | - | - | - | - | - | - | - | - | - | - |
| /onboarding | - | - | - | - | - | - | - | - | - | - | - |
| /api/health | - | - | - | - | - | - | - | - | - | - | - |
| /q/:qrToken | 略過：未提供 PERFORMANCE_QR_TOKEN | - | - | - | - | - | - | - | - | - | - |
| /staff/orders | - | - | - | - | - | - | - | - | - | - | - |
| /merchant/dashboard | - | - | - | - | - | - | - | - | - | - | - |

## Cache headers

| 路由 | Cache-Control | Vercel-CDN-Cache-Control | CDN-Cache-Control | Age | Vary | Set-Cookie |
| --- | --- | --- | --- | ---: | --- | --- |
| / | - | - | - | - | - | 無 |
| /login | - | - | - | - | - | 無 |
| /onboarding | - | - | - | - | - | 無 |
| /api/health | - | - | - | - | - | 無 |
| /staff/orders | - | - | - | - | - | 無 |
| /merchant/dashboard | - | - | - | - | - | 無 |

## 瀏覽器結果

| 路由 | 裝置 | TTFB | FCP | LCP | JS 傳輸 | 圖片傳輸 | Order Session |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| / | desktop | - | - | - | - | - | - |
| / | android_mobile_synthetic_tw | - | - | - | - | - | - |
| /login | desktop | - | - | - | - | - | - |
| /login | android_mobile_synthetic_tw | - | - | - | - | - | - |
| /onboarding | desktop | - | - | - | - | - | - |
| /onboarding | android_mobile_synthetic_tw | - | - | - | - | - | - |
| /api/health | desktop | - | - | - | - | - | - |
| /api/health | android_mobile_synthetic_tw | - | - | - | - | - | - |
| /staff/orders | desktop | - | - | - | - | - | - |
| /staff/orders | android_mobile_synthetic_tw | - | - | - | - | - | - |
| /merchant/dashboard | desktop | - | - | - | - | - | - |
| /merchant/dashboard | android_mobile_synthetic_tw | - | - | - | - | - | - |

## 預算警告

- /: cold-like HTTP 要求失敗
- /: 2 筆 warm HTTP 要求失敗
- /: desktop 瀏覽器量測失敗
- /: android_mobile_synthetic_tw 瀏覽器量測失敗
- /login: cold-like HTTP 要求失敗
- /login: 2 筆 warm HTTP 要求失敗
- /login: desktop 瀏覽器量測失敗
- /login: android_mobile_synthetic_tw 瀏覽器量測失敗
- /onboarding: cold-like HTTP 要求失敗
- /onboarding: 2 筆 warm HTTP 要求失敗
- /onboarding: desktop 瀏覽器量測失敗
- /onboarding: android_mobile_synthetic_tw 瀏覽器量測失敗
- /api/health: cold-like HTTP 要求失敗
- /api/health: 2 筆 warm HTTP 要求失敗
- /api/health: desktop 瀏覽器量測失敗
- /api/health: android_mobile_synthetic_tw 瀏覽器量測失敗
- /staff/orders: cold-like HTTP 要求失敗
- /staff/orders: 2 筆 warm HTTP 要求失敗
- /staff/orders: desktop 瀏覽器量測失敗
- /staff/orders: android_mobile_synthetic_tw 瀏覽器量測失敗
- /merchant/dashboard: cold-like HTTP 要求失敗
- /merchant/dashboard: 2 筆 warm HTTP 要求失敗
- /merchant/dashboard: desktop 瀏覽器量測失敗
- /merchant/dashboard: android_mobile_synthetic_tw 瀏覽器量測失敗

## 限制

- 網際網路要求無法穩定強制 Vercel Serverless cold start，因此 cold-like 僅作第一筆比較。
- `x-vercel-id` 第一段是入口 Edge PoP，不是 Function 執行區；Function 區域須由 Vercel Deployment API 驗證。
- `Server-Timing` 尚未提供的細項會保留為空值，不以總時間猜測資料庫或外部服務耗時。
- 未提供測試憑證時，受保護路由只會量到重新導向或拒絕回應。
- `/staff/orders` 是需求中的概念路徑；專案實際店員訂單頁為 `/staff/:stallSlug`，可用 `PERFORMANCE_STAFF_PATH` 另外量測。
