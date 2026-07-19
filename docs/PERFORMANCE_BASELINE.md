# StallOrder 效能基準

- 量測時間：2026-07-18T19:00:36.327Z
- 階段：baseline
- 版本：d62dd89f6760285f34ce41306263c16256459183
- Function region：iad1
- 目標來源：https://stallorder-platform.vercel.app
- 每條路由要求數：6（第一筆為 cold-like，其餘為 warm）
- 驗證狀態：未登入
- 隱私：未保存回應本文、Cookie、密碼、Session 或原始 QR Token。

> cold-like 是帶 `Cache-Control: no-cache` 的第一筆要求，不代表一定觸發 Vercel Function 真正冷啟動。Android 數據為 80ms RTT、4 Mbps 下載的合成網路。

## HTTP 結果

| 路由 | 狀態 | Cold DNS | Cold TCP | Cold TLS | Cold TTFB | Cold 總時間 | Warm TTFB P75 | Warm 總時間 P75 | 回應大小 | Cache | Edge PoP |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| / | 200 | 2.9 ms | 10 ms | 35.1 ms | 341 ms | 344.7 ms | 252.2 ms | 255.4 ms | 21.5 KB | MISS | hkg1 |
| /login | 200 | 0.4 ms | 4.9 ms | 36.9 ms | 294.9 ms | 299.3 ms | 258.3 ms | 264.8 ms | 12.2 KB | MISS | hkg1 |
| /onboarding | 307 | 0.4 ms | 5.4 ms | 37 ms | 302 ms | 303.1 ms | 252.1 ms | 253 ms | 8.6 KB | MISS | hkg1 |
| /api/health | 200 | 0.5 ms | 5.3 ms | 38.4 ms | 1038.5 ms | 1039 ms | 1004.8 ms | 1006.6 ms | 54 B | MISS | hkg1 |
| /q/:qrToken | 略過：未提供 PERFORMANCE_QR_TOKEN | - | - | - | - | - | - | - | - | - | - |
| /staff/orders | 307 | 0.4 ms | 5.4 ms | 37.3 ms | 354.7 ms | 355.1 ms | 251.2 ms | 252.3 ms | 9.3 KB | MISS | hkg1 |
| /merchant/dashboard | 307 | 0.4 ms | 5.4 ms | 37.4 ms | 313.4 ms | 314.3 ms | 253.2 ms | 254.3 ms | 9 KB | MISS | hkg1 |

## Cache headers

| 路由 | Cache-Control | Vercel-CDN-Cache-Control | CDN-Cache-Control | Age | Vary | Set-Cookie |
| --- | --- | --- | --- | ---: | --- | --- |
| / | private, no-cache, no-store, max-age=0, must-revalidate | - | - | 0 | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |
| /login | private, no-cache, no-store, max-age=0, must-revalidate | - | - | 0 | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |
| /onboarding | private, no-cache, no-store, max-age=0, must-revalidate | - | - | 0 | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |
| /api/health | no-store | - | - | 0 | - | 無 |
| /staff/orders | private, no-cache, no-store, max-age=0, must-revalidate | - | - | 0 | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |
| /merchant/dashboard | private, no-cache, no-store, max-age=0, must-revalidate | - | - | 0 | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |

## 瀏覽器結果

| 路由 | 裝置 | TTFB | FCP | LCP | JS 傳輸 | 圖片傳輸 | Order Session |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| / | desktop | 19.5 ms | - | - | 155.5 KB | 0 B | - |
| / | android_mobile_synthetic_tw | 18.8 ms | 792 ms | 792 ms | 155.5 KB | 0 B | - |
| /login | desktop | 19.8 ms | 668 ms | 668 ms | 157 KB | 0 B | - |
| /login | android_mobile_synthetic_tw | 18.6 ms | 812 ms | 812 ms | 157 KB | 0 B | - |
| /onboarding | desktop | 18.5 ms | 1000 ms | 1000 ms | 157 KB | 0 B | - |
| /onboarding | android_mobile_synthetic_tw | 18.7 ms | 1088 ms | 1088 ms | 157 KB | 0 B | - |
| /api/health | desktop | 19.1 ms | 1392 ms | 1392 ms | 0 B | 0 B | - |
| /api/health | android_mobile_synthetic_tw | 19.3 ms | 1156 ms | 1156 ms | 0 B | 0 B | - |
| /staff/orders | desktop | 18.5 ms | 1028 ms | 1028 ms | 157 KB | 0 B | - |
| /staff/orders | android_mobile_synthetic_tw | 20.8 ms | 1100 ms | 1100 ms | 157 KB | 0 B | - |
| /merchant/dashboard | desktop | 19.9 ms | 1208 ms | 1208 ms | 157 KB | 0 B | - |
| /merchant/dashboard | android_mobile_synthetic_tw | 19.4 ms | 1100 ms | 1100 ms | 157 KB | 0 B | - |

## 預算警告

- /api/health: 暖要求總時間 P75 1006.6ms 超過 300ms 預算

## 限制

- 網際網路要求無法穩定強制 Vercel Serverless cold start，因此 cold-like 僅作第一筆比較。
- `x-vercel-id` 第一段是入口 Edge PoP，不是 Function 執行區；Function 區域須由 Vercel Deployment API 驗證。
- `Server-Timing` 尚未提供的細項會保留為空值，不以總時間猜測資料庫或外部服務耗時。
- 未提供測試憑證時，受保護路由只會量到重新導向或拒絕回應。
- `/staff/orders` 是需求中的概念路徑；專案實際店員訂單頁為 `/staff/:stallSlug`，可用 `PERFORMANCE_STAFF_PATH` 另外量測。
