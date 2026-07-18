# StallOrder 效能基準

- 量測時間：2026-07-18T21:40:16.304Z
- 階段：p3-confirmation
- 版本：7ce1182e2e395cf8a69d8d8b31bf19a58cc8aa40
- Function region：hnd1
- 目標來源：https://stallorder-platform-dbt8qc08v-ada76145-8663s-projects.vercel.app
- 每條路由要求數：6（第一筆為 cold-like，其餘為 warm）
- 驗證狀態：使用環境變數提供的測試帳號
- 隱私：未保存回應本文、Cookie、密碼、Session 或原始 QR Token。

> cold-like 是帶 `Cache-Control: no-cache` 的第一筆要求，不代表一定觸發 Vercel Function 真正冷啟動。Android 數據為 80ms RTT、4 Mbps 下載的合成網路。

## HTTP 結果

| 路由 | 狀態 | Cold DNS | Cold TCP | Cold TLS | Cold TTFB | Cold 總時間 | Warm TTFB P75 | Warm 總時間 P75 | 回應大小 | Cache | Edge PoP |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| / | 200 | 0.4 ms | 5.5 ms | 36.1 ms | 77.9 ms | 79 ms | 23.4 ms | 25.4 ms | 22.2 KB | HIT | hkg1 |
| /login | 200 | 0.3 ms | 5.1 ms | 36.5 ms | 67.1 ms | 68.8 ms | 22.8 ms | 24.3 ms | 12.8 KB | HIT | hkg1 |
| /onboarding | 307 | 0.4 ms | 6.8 ms | 36.9 ms | 321.3 ms | 322.1 ms | 134.5 ms | 135.4 ms | 8.8 KB | MISS | hkg1 |
| /api/health | 200 | 0.6 ms | 8.4 ms | 38.3 ms | 161.4 ms | 161.5 ms | 113.6 ms | 113.7 ms | 54 B | MISS | hkg1 |
| /q/:qrToken | 200 | 0.5 ms | 5.1 ms | 36.2 ms | 250.5 ms | 324.4 ms | 135.3 ms | 146.5 ms | 22.6 KB | MISS | hkg1 |
| /api/public/stalls/:stallSlug/menu | 200 | 0.7 ms | 7.4 ms | 38.1 ms | 200.5 ms | 237.3 ms | 130 ms | 172.2 ms | 558 B | MISS | hkg1 |
| /staff/orders | 404 | 0.4 ms | 5.2 ms | 35.9 ms | 221.6 ms | 223.4 ms | 162.2 ms | 162.4 ms | 9.4 KB | MISS | hkg1 |
| /staff/:stallSlug（實際路由） | 200 | 0.7 ms | 5.5 ms | 37.6 ms | 250.7 ms | 327.5 ms | 189.5 ms | 239.9 ms | 24 KB | MISS | hkg1 |
| /merchant/dashboard | 200 | 0.4 ms | 6.3 ms | 36.1 ms | 249.4 ms | 252.1 ms | 185.2 ms | 187.5 ms | 26.4 KB | MISS | hkg1 |
| /merchant/reports（實際路由） | 200 | 0.5 ms | 7 ms | 36 ms | 572.6 ms | 624.1 ms | 174.9 ms | 215.4 ms | 51.5 KB | MISS | hkg1 |

## Cache headers

| 路由 | Cache-Control | Vercel-CDN-Cache-Control | CDN-Cache-Control | Age | Vary | Set-Cookie |
| --- | --- | --- | --- | ---: | --- | --- |
| / | public, max-age=0, must-revalidate | - | public, s-maxage=600, stale-while-revalidate=3600 | 359 | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |
| /login | public, max-age=0, must-revalidate | - | public, s-maxage=60, stale-while-revalidate=300 | 169 | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |
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
| / | desktop | 19 ms | - | - | 164.2 KB | 0 B | - |
| / | android_mobile_synthetic_tw | 20.2 ms | 800 ms | 800 ms | 164.2 KB | 0 B | - |
| /login | desktop | 20 ms | 976 ms | 976 ms | 165.8 KB | 0 B | - |
| /login | android_mobile_synthetic_tw | 19.3 ms | 672 ms | 672 ms | 165.8 KB | 0 B | - |
| /onboarding | desktop | 19 ms | 660 ms | 660 ms | 165.8 KB | 0 B | - |
| /onboarding | android_mobile_synthetic_tw | 20.1 ms | 812 ms | 812 ms | 165.8 KB | 0 B | - |
| /api/health | desktop | 18.7 ms | 608 ms | 608 ms | 0 B | 0 B | - |
| /api/health | android_mobile_synthetic_tw | 19.6 ms | 232 ms | 232 ms | 0 B | 0 B | - |
| /q/:qrToken | desktop | 18.8 ms | 668 ms | 668 ms | 186.8 KB | 876 B | 1174.5 ms（HTTP 201） |
| /q/:qrToken | android_mobile_synthetic_tw | 19.3 ms | 732 ms | 732 ms | 186.8 KB | 876 B | 767.8 ms（HTTP 201） |
| /api/public/stalls/:stallSlug/menu | desktop | 18.9 ms | 652 ms | 652 ms | 0 B | 0 B | - |
| /api/public/stalls/:stallSlug/menu | android_mobile_synthetic_tw | 27.3 ms | 240 ms | 240 ms | 0 B | 0 B | - |
| /staff/orders | desktop | 18.9 ms | 664 ms | 664 ms | 161.3 KB | 0 B | - |
| /staff/orders | android_mobile_synthetic_tw | 20.2 ms | 912 ms | 912 ms | 161.3 KB | 0 B | - |
| /staff/:stallSlug（實際路由） | desktop | 19 ms | 684 ms | 684 ms | 186.6 KB | 0 B | - |
| /staff/:stallSlug（實際路由） | android_mobile_synthetic_tw | 19.1 ms | 792 ms | 792 ms | 186.6 KB | 0 B | - |
| /merchant/dashboard | desktop | 19.1 ms | 652 ms | 652 ms | 177 KB | 0 B | - |
| /merchant/dashboard | android_mobile_synthetic_tw | 19.6 ms | 744 ms | 744 ms | 177 KB | 0 B | - |
| /merchant/reports（實際路由） | desktop | 19.3 ms | 628 ms | 628 ms | 171.4 KB | 0 B | - |
| /merchant/reports（實際路由） | android_mobile_synthetic_tw | 19.2 ms | 784 ms | 784 ms | 171.4 KB | 0 B | - |

## 預算警告

- /q/:qrToken: desktop order session 1174.5ms 超過 800ms 預算

## 限制

- 網際網路要求無法穩定強制 Vercel Serverless cold start，因此 cold-like 僅作第一筆比較。
- `x-vercel-id` 第一段是入口 Edge PoP，不是 Function 執行區；Function 區域須由 Vercel Deployment API 驗證。
- `Server-Timing` 尚未提供的細項會保留為空值，不以總時間猜測資料庫或外部服務耗時。
- 未提供測試憑證時，受保護路由只會量到重新導向或拒絕回應。
- `/staff/orders` 是需求中的概念路徑；專案實際店員訂單頁為 `/staff/:stallSlug`，可用 `PERFORMANCE_STAFF_PATH` 另外量測。
