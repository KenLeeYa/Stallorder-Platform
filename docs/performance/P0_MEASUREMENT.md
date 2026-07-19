# StallOrder 效能基準

- 量測時間：2026-07-18T19:32:07.245Z
- 階段：p0
- 版本：4f537374d37fae836bd670bb7c1dea15904337b8
- Function region：hnd1
- 目標來源：https://stallorder-platform-3bq4inhhy-ada76145-8663s-projects.vercel.app
- 每條路由要求數：6（第一筆為 cold-like，其餘為 warm）
- 驗證狀態：未登入
- 隱私：未保存回應本文、Cookie、密碼、Session 或原始 QR Token。

> cold-like 是帶 `Cache-Control: no-cache` 的第一筆要求，不代表一定觸發 Vercel Function 真正冷啟動。Android 數據為 80ms RTT、4 Mbps 下載的合成網路。

## HTTP 結果

| 路由 | 狀態 | Cold DNS | Cold TCP | Cold TLS | Cold TTFB | Cold 總時間 | Warm TTFB P75 | Warm 總時間 P75 | 回應大小 | Cache | Edge PoP |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| / | 200 | 4 ms | 9.7 ms | 37.1 ms | 234.1 ms | 237 ms | 109.9 ms | 111.9 ms | 21.5 KB | MISS | hkg1 |
| /login | 200 | 5 ms | 6.8 ms | 37.8 ms | 169.6 ms | 172.2 ms | 99.3 ms | 100.6 ms | 12.2 KB | MISS | hkg1 |
| /onboarding | 307 | 0.4 ms | 4.8 ms | 41.1 ms | 158.2 ms | 160.5 ms | 102.7 ms | 103.8 ms | 8.6 KB | MISS | hkg1 |
| /api/health | 200 | 13 ms | 7.4 ms | 36.6 ms | 179.9 ms | 180 ms | 115.2 ms | 115.3 ms | 54 B | MISS | hkg1 |
| /q/:qrToken | 略過：未提供 PERFORMANCE_QR_TOKEN | - | - | - | - | - | - | - | - | - | - |
| /staff/orders | 307 | 0.5 ms | 7.2 ms | 37.1 ms | 180 ms | 180.8 ms | 109.2 ms | 109.3 ms | 9.3 KB | MISS | hkg1 |
| /merchant/dashboard | 307 | 1 ms | 9 ms | 35.6 ms | 173.7 ms | 175.2 ms | 102.8 ms | 104.2 ms | 9 KB | MISS | hkg1 |

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
| / | desktop | 18.7 ms | - | - | 155.4 KB | 0 B | - |
| / | android_mobile_synthetic_tw | 18.7 ms | 664 ms | 664 ms | 155.4 KB | 0 B | - |
| /login | desktop | 18.6 ms | 676 ms | 676 ms | 156.9 KB | 0 B | - |
| /login | android_mobile_synthetic_tw | 20.2 ms | 680 ms | 680 ms | 156.9 KB | 0 B | - |
| /onboarding | desktop | 19.7 ms | 644 ms | 644 ms | 156.9 KB | 0 B | - |
| /onboarding | android_mobile_synthetic_tw | 18.7 ms | 748 ms | 748 ms | 156.9 KB | 0 B | - |
| /api/health | desktop | 19.7 ms | 660 ms | 660 ms | 0 B | 0 B | - |
| /api/health | android_mobile_synthetic_tw | 20.3 ms | 244 ms | 244 ms | 0 B | 0 B | - |
| /staff/orders | desktop | 18.6 ms | 900 ms | 900 ms | 156.9 KB | 0 B | - |
| /staff/orders | android_mobile_synthetic_tw | 19.7 ms | 796 ms | 796 ms | 156.9 KB | 0 B | - |
| /merchant/dashboard | desktop | 18.8 ms | 712 ms | 712 ms | 156.9 KB | 0 B | - |
| /merchant/dashboard | android_mobile_synthetic_tw | 18.8 ms | 800 ms | 800 ms | 156.9 KB | 0 B | - |

## 預算警告

目前量測項目沒有觸發預算警告；未量測項目不視為通過。

## 限制

- 網際網路要求無法穩定強制 Vercel Serverless cold start，因此 cold-like 僅作第一筆比較。
- `x-vercel-id` 第一段是入口 Edge PoP，不是 Function 執行區；Function 區域須由 Vercel Deployment API 驗證。
- `Server-Timing` 尚未提供的細項會保留為空值，不以總時間猜測資料庫或外部服務耗時。
- 未提供測試憑證時，受保護路由只會量到重新導向或拒絕回應。
- `/staff/orders` 是需求中的概念路徑；專案實際店員訂單頁為 `/staff/:stallSlug`，可用 `PERFORMANCE_STAFF_PATH` 另外量測。

## P0 部署證據

- Vercel Preview：`dpl_4wCYqFrnuvm9NsFTp65VzFMtrvwE`，`READY`，Function region `hnd1`。
- Supabase Staging 的 `create-order-session`、`create-public-order`、`get-public-order` 已部署為 version 3；維持既有 `verify_jwt=false`，因函式本體使用 gateway secret、QR/session、rate limit 與 Turnstile 等自訂驗證。
- 透過 Vercel public-order proxy 傳送不含 token 的空 JSON，Staging `create-order-session` version 3 正確回傳 HTTP 400，證明 bundle 編譯、代理與 Edge Function 可連線；未建立 session 或訂單。
- Vercel 對外回應未保留應用設定的 `Server-Timing`。Runtime structured log 仍有 `request_completed`；15 筆 health 樣本的應用 `totalMs` 平均 13.7 ms、`dbMs` 平均 13.2 ms。
