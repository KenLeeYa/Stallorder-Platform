# StallOrder 效能基準

- 量測時間：2026-07-18T22:15:24.867Z
- 階段：final-local
- 版本：未提供
- Function region：local
- 目標來源：http://127.0.0.1:3000
- 每條路由要求數：4（第一筆為 cold-like，其餘為 warm）
- 驗證狀態：未登入
- 隱私：未保存回應本文、Cookie、密碼、Session 或原始 QR Token。

> cold-like 是帶 `Cache-Control: no-cache` 的第一筆要求，不代表一定觸發 Vercel Function 真正冷啟動。Android 數據為 80ms RTT、4 Mbps 下載的合成網路。

## HTTP 結果

| 路由 | 狀態 | Cold DNS | Cold TCP | Cold TLS | Cold TTFB | Cold 總時間 | Warm TTFB P75 | Warm 總時間 P75 | 回應大小 | Cache | Edge PoP |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| / | 200 | - | 3.7 ms | - | 41.8 ms | 42.5 ms | 2.7 ms | 2.8 ms | 21.8 KB | - | - |
| /login | 200 | - | 0.1 ms | - | 8.9 ms | 9 ms | 1.7 ms | 1.8 ms | 12.5 KB | - | - |
| /onboarding | 307 | - | 0.1 ms | - | 33.5 ms | 34.6 ms | 6.6 ms | 7.1 ms | 8.6 KB | - | - |
| /api/health | 200 | - | 0.3 ms | - | 10 ms | 10.3 ms | 4.3 ms | 4.4 ms | 54 B | - | - |
| /q/:qrToken | 200 | - | 0.1 ms | - | 18.1 ms | 61.3 ms | 11 ms | 11.7 ms | 33.8 KB | - | - |
| /api/public/stalls/:stallSlug/menu | 200 | - | 0.1 ms | - | 18 ms | 50.2 ms | 6.7 ms | 6.8 ms | 9.7 KB | - | - |
| /staff/orders | 307 | - | 0.2 ms | - | 20.1 ms | 20.6 ms | 4.8 ms | 5.1 ms | 9.2 KB | - | - |
| /merchant/dashboard | 307 | - | 0.1 ms | - | 19.4 ms | 19.6 ms | 8 ms | 9 ms | 8.9 KB | - | - |

## Cache headers

| 路由 | Cache-Control | Vercel-CDN-Cache-Control | CDN-Cache-Control | Age | Vary | Set-Cookie |
| --- | --- | --- | --- | ---: | --- | --- |
| / | public, max-age=0, must-revalidate | public, s-maxage=3600, stale-while-revalidate=86400 | public, s-maxage=600, stale-while-revalidate=3600 | - | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding | 無 |
| /login | public, max-age=0, must-revalidate | public, s-maxage=300, stale-while-revalidate=3600 | public, s-maxage=60, stale-while-revalidate=300 | - | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding | 無 |
| /onboarding | private, no-cache, no-store, max-age=0, must-revalidate | - | - | - | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding | 無 |
| /api/health | no-store | - | - | - | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |
| /q/:qrToken | private, no-cache, no-store, max-age=0, must-revalidate | - | - | - | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding | 無 |
| /api/public/stalls/:stallSlug/menu | public, max-age=0, must-revalidate | public, s-maxage=15, stale-while-revalidate=15 | public, s-maxage=10, stale-while-revalidate=10 | - | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |
| /staff/orders | private, no-cache, no-store, max-age=0, must-revalidate | - | - | - | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding | 無 |
| /merchant/dashboard | private, no-cache, no-store, max-age=0, must-revalidate | - | - | - | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding | 無 |

## 瀏覽器結果

| 路由 | 裝置 | TTFB | FCP | LCP | JS 傳輸 | 圖片傳輸 | Order Session |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| / | desktop | 5.4 ms | - | - | 153.4 KB | 0 B | - |
| / | android_mobile_synthetic_tw | 2.5 ms | - | - | 153.4 KB | 0 B | - |
| /login | desktop | 1.5 ms | - | - | 154.9 KB | 0 B | - |
| /login | android_mobile_synthetic_tw | 1.5 ms | 512 ms | 512 ms | 154.9 KB | 0 B | - |
| /onboarding | desktop | 1.9 ms | - | - | 154.9 KB | 0 B | - |
| /onboarding | android_mobile_synthetic_tw | 2.2 ms | 644 ms | 644 ms | 154.9 KB | 0 B | - |
| /api/health | desktop | 7.4 ms | - | - | 0 B | 0 B | - |
| /api/health | android_mobile_synthetic_tw | 6.1 ms | 164 ms | 164 ms | 0 B | 0 B | - |
| /q/:qrToken | desktop | 9.8 ms | 648 ms | 648 ms | 174.7 KB | 888 B | 86.1 ms（HTTP 201） |
| /q/:qrToken | android_mobile_synthetic_tw | 11.2 ms | 520 ms | 520 ms | 174.7 KB | 888 B | 129.1 ms（HTTP 201） |
| /api/public/stalls/:stallSlug/menu | desktop | 8.4 ms | - | - | 0 B | 0 B | - |
| /api/public/stalls/:stallSlug/menu | android_mobile_synthetic_tw | 7.8 ms | 212 ms | 212 ms | 0 B | 0 B | - |
| /staff/orders | desktop | 2.2 ms | - | - | 154.9 KB | 0 B | - |
| /staff/orders | android_mobile_synthetic_tw | 2.7 ms | 660 ms | 660 ms | 154.9 KB | 0 B | - |
| /merchant/dashboard | desktop | 2 ms | - | - | 154.9 KB | 0 B | - |
| /merchant/dashboard | android_mobile_synthetic_tw | 2.6 ms | 644 ms | 644 ms | 154.9 KB | 0 B | - |

## 預算警告

目前量測項目沒有觸發預算警告；未量測項目不視為通過。

## 限制

- 網際網路要求無法穩定強制 Vercel Serverless cold start，因此 cold-like 僅作第一筆比較。
- `x-vercel-id` 第一段是入口 Edge PoP，不是 Function 執行區；Function 區域須由 Vercel Deployment API 驗證。
- `Server-Timing` 尚未提供的細項會保留為空值，不以總時間猜測資料庫或外部服務耗時。
- 未提供測試憑證時，受保護路由只會量到重新導向或拒絕回應。
- `/staff/orders` 是需求中的概念路徑；專案實際店員訂單頁為 `/staff/:stallSlug`，可用 `PERFORMANCE_STAFF_PATH` 另外量測。
