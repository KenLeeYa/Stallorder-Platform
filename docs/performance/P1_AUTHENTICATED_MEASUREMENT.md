# StallOrder 效能基準

- 量測時間：2026-07-18T20:25:18.145Z
- 階段：p1-authenticated
- 版本：61a006ff7dd00e9133a19ff1b0c27541cf357d87
- Function region：hnd1
- 目標來源：https://stallorder-platform-o674drxz4-ada76145-8663s-projects.vercel.app
- 每條路由要求數：6（第一筆為 cold-like，其餘為 warm）
- 驗證狀態：使用環境變數提供的測試帳號
- 隱私：未保存回應本文、Cookie、密碼、Session 或原始 QR Token。

> cold-like 是帶 `Cache-Control: no-cache` 的第一筆要求，不代表一定觸發 Vercel Function 真正冷啟動。Android 數據為 80ms RTT、4 Mbps 下載的合成網路。

## HTTP 結果

| 路由 | 狀態 | Cold DNS | Cold TCP | Cold TLS | Cold TTFB | Cold 總時間 | Warm TTFB P75 | Warm 總時間 P75 | 回應大小 | Cache | Edge PoP |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| / | 200 | 18.9 ms | 7.5 ms | 36.5 ms | 91.9 ms | 94.1 ms | 31.2 ms | 33.5 ms | 21.8 KB | HIT | hkg1 |
| /login | 200 | 2.9 ms | 6.6 ms | 37.8 ms | 77.6 ms | 78.9 ms | 23.9 ms | 25.1 ms | 12.5 KB | HIT | hkg1 |
| /onboarding | 307 | 0.7 ms | 7.7 ms | 37.5 ms | 462.7 ms | 472.9 ms | 135 ms | 135.7 ms | 8.7 KB | MISS | hkg1 |
| /api/health | 200 | 0.4 ms | 6.9 ms | 37.4 ms | 212.9 ms | 213.1 ms | 130.3 ms | 130.4 ms | 54 B | MISS | hkg1 |
| /q/:qrToken | 200 | 0.4 ms | 6.9 ms | 37.1 ms | 379.9 ms | 381.1 ms | 126.6 ms | 129 ms | 15.8 KB | MISS | hkg1 |
| /api/public/stalls/:stallSlug/menu | 200 | 0.8 ms | 5.5 ms | 42.2 ms | 285.2 ms | 348.7 ms | 146 ms | 146.2 ms | 558 B | MISS | hkg1 |
| /staff/orders | 404 | 0.4 ms | 4.7 ms | 36.8 ms | 268.7 ms | 270.5 ms | 155 ms | 155.7 ms | 9.4 KB | MISS | hkg1 |
| /staff/:stallSlug（實際路由） | 200 | 0.4 ms | 7.5 ms | 37.3 ms | 374.9 ms | 378.7 ms | 246.3 ms | 249 ms | 17.9 KB | MISS | hkg1 |
| /merchant/dashboard | 200 | 0.3 ms | 7.4 ms | 36.7 ms | 629.5 ms | 641.1 ms | 185.3 ms | 189.3 ms | 24.8 KB | MISS | hkg1 |
| /merchant/reports（實際路由） | 200 | 0.5 ms | 7.7 ms | 38.4 ms | 706 ms | 713.4 ms | 199.7 ms | 205.6 ms | 45.2 KB | MISS | hkg1 |

## Cache headers

| 路由 | Cache-Control | Vercel-CDN-Cache-Control | CDN-Cache-Control | Age | Vary | Set-Cookie |
| --- | --- | --- | --- | ---: | --- | --- |
| / | public, max-age=0, must-revalidate | - | public, s-maxage=600, stale-while-revalidate=3600 | 1594 | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |
| /login | public, max-age=0, must-revalidate | - | public, s-maxage=60, stale-while-revalidate=300 | 1130 | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |
| /onboarding | private, no-cache, no-store, max-age=0, must-revalidate | - | - | 0 | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |
| /api/health | no-store | - | - | 0 | - | 無 |
| /q/:qrToken | private, no-cache, no-store, max-age=0, must-revalidate | - | - | 0 | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |
| /api/public/stalls/:stallSlug/menu | private, no-store, max-age=0 | - | - | 0 | - | 無 |
| /staff/orders | private, no-cache, no-store, max-age=0, must-revalidate | - | - | 0 | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |
| /staff/:stallSlug（實際路由） | private, no-cache, no-store, max-age=0, must-revalidate | - | - | 0 | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |
| /merchant/dashboard | private, no-cache, no-store, max-age=0, must-revalidate | - | - | 0 | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |
| /merchant/reports（實際路由） | private, no-cache, no-store, max-age=0, must-revalidate | - | - | 0 | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |

## 瀏覽器結果

| 路由 | 裝置 | TTFB | FCP | LCP | JS 傳輸 | 圖片傳輸 | Order Session |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| / | desktop | 19 ms | 3312 ms | 3312 ms | 159.9 KB | 0 B | - |
| / | android_mobile_synthetic_tw | 18.8 ms | 656 ms | 656 ms | 155.4 KB | 0 B | - |
| /login | desktop | 19 ms | 632 ms | 632 ms | 157.1 KB | 0 B | - |
| /login | android_mobile_synthetic_tw | 20 ms | 676 ms | 676 ms | 157.1 KB | 0 B | - |
| /onboarding | desktop | 18.7 ms | 688 ms | 688 ms | 157.1 KB | 0 B | - |
| /onboarding | android_mobile_synthetic_tw | 19.4 ms | 828 ms | 828 ms | 157.1 KB | 0 B | - |
| /api/health | desktop | 18.9 ms | 652 ms | 652 ms | 0 B | 0 B | - |
| /api/health | android_mobile_synthetic_tw | 20.2 ms | 332 ms | 332 ms | 0 B | 0 B | - |
| /q/:qrToken | desktop | 19.3 ms | 648 ms | 648 ms | 178.4 KB | 876 B | 577.8 ms |
| /q/:qrToken | android_mobile_synthetic_tw | 20.3 ms | 840 ms | 840 ms | 178.4 KB | 876 B | 282 ms |
| /api/public/stalls/:stallSlug/menu | desktop | 19.4 ms | 632 ms | 632 ms | 0 B | 0 B | - |
| /api/public/stalls/:stallSlug/menu | android_mobile_synthetic_tw | 19.4 ms | 336 ms | 336 ms | 0 B | 0 B | - |
| /staff/orders | desktop | 18.6 ms | 664 ms | 664 ms | 152.6 KB | 0 B | - |
| /staff/orders | android_mobile_synthetic_tw | 20.2 ms | 880 ms | 880 ms | 152.6 KB | 0 B | - |
| /staff/:stallSlug（實際路由） | desktop | 19.5 ms | 680 ms | 680 ms | 241.8 KB | 0 B | - |
| /staff/:stallSlug（實際路由） | android_mobile_synthetic_tw | 20.1 ms | 856 ms | 856 ms | 241.8 KB | 0 B | - |
| /merchant/dashboard | desktop | 19.1 ms | 684 ms | 684 ms | 232.2 KB | 0 B | - |
| /merchant/dashboard | android_mobile_synthetic_tw | 20.1 ms | 796 ms | 796 ms | 232.2 KB | 0 B | - |
| /merchant/reports（實際路由） | desktop | 19.3 ms | 676 ms | 676 ms | 162.6 KB | 0 B | - |
| /merchant/reports（實際路由） | android_mobile_synthetic_tw | 19.1 ms | 728 ms | 728 ms | 162.6 KB | 0 B | - |

## 預算警告

目前量測項目沒有觸發預算警告；未量測項目不視為通過。

## 限制

- 網際網路要求無法穩定強制 Vercel Serverless cold start，因此 cold-like 僅作第一筆比較。
- `x-vercel-id` 第一段是入口 Edge PoP，不是 Function 執行區；Function 區域須由 Vercel Deployment API 驗證。
- `Server-Timing` 尚未提供的細項會保留為空值，不以總時間猜測資料庫或外部服務耗時。
- 未提供測試憑證時，受保護路由只會量到重新導向或拒絕回應。
- `/staff/orders` 是需求中的概念路徑；專案實際店員訂單頁為 `/staff/:stallSlug`，可用 `PERFORMANCE_STAFF_PATH` 另外量測。
