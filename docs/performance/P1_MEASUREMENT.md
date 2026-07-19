# StallOrder 效能基準

- 量測時間：2026-07-18T20:13:20.744Z
- 階段：p1
- 版本：61a006ff7dd00e9133a19ff1b0c27541cf357d87
- Function region：hnd1
- 目標來源：https://stallorder-platform-o674drxz4-ada76145-8663s-projects.vercel.app
- 每條路由要求數：6（第一筆為 cold-like，其餘為 warm）
- 驗證狀態：未登入
- 隱私：未保存回應本文、Cookie、密碼、Session 或原始 QR Token。

> cold-like 是帶 `Cache-Control: no-cache` 的第一筆要求，不代表一定觸發 Vercel Function 真正冷啟動。Android 數據為 80ms RTT、4 Mbps 下載的合成網路。

## HTTP 結果

| 路由 | 狀態 | Cold DNS | Cold TCP | Cold TLS | Cold TTFB | Cold 總時間 | Warm TTFB P75 | Warm 總時間 P75 | 回應大小 | Cache | Edge PoP |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| / | 200 | 19.2 ms | 7.3 ms | 37.5 ms | 111.8 ms | 113.3 ms | 28.8 ms | 31.4 ms | 21.8 KB | HIT | hkg1 |
| /login | 200 | 0.4 ms | 5.6 ms | 36.7 ms | 70.9 ms | 71.8 ms | 24.7 ms | 25.7 ms | 12.5 KB | HIT | hkg1 |
| /onboarding | 307 | 0.3 ms | 7.5 ms | 36.6 ms | 163.9 ms | 164.9 ms | 113.6 ms | 114.6 ms | 8.6 KB | MISS | hkg1 |
| /api/health | 200 | 0.3 ms | 5.5 ms | 37.8 ms | 161.3 ms | 161.4 ms | 110.5 ms | 110.8 ms | 54 B | MISS | hkg1 |
| /q/:qrToken | 200 | 0.7 ms | 8 ms | 40.4 ms | 219.5 ms | 220.7 ms | 126.1 ms | 127.8 ms | 15.8 KB | MISS | hkg1 |
| /api/public/stalls/:stallSlug/menu | 200 | 0.4 ms | 6.7 ms | 36.5 ms | 186.8 ms | 234.7 ms | 25 ms | 25.1 ms | 558 B | HIT | hkg1 |
| /staff/orders | 307 | 0.4 ms | 7.3 ms | 35.7 ms | 157.7 ms | 158.6 ms | 108.4 ms | 110.2 ms | 9.3 KB | MISS | hkg1 |
| /merchant/dashboard | 307 | 0.7 ms | 6.3 ms | 36.5 ms | 158.7 ms | 159.4 ms | 104.4 ms | 105.2 ms | 9 KB | MISS | hkg1 |

## Cache headers

| 路由 | Cache-Control | Vercel-CDN-Cache-Control | CDN-Cache-Control | Age | Vary | Set-Cookie |
| --- | --- | --- | --- | ---: | --- | --- |
| / | public, max-age=0, must-revalidate | - | public, s-maxage=600, stale-while-revalidate=3600 | 875 | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |
| /login | public, max-age=0, must-revalidate | - | public, s-maxage=60, stale-while-revalidate=300 | 407 | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |
| /onboarding | private, no-cache, no-store, max-age=0, must-revalidate | - | - | 0 | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |
| /api/health | no-store | - | - | 0 | - | 無 |
| /q/:qrToken | private, no-cache, no-store, max-age=0, must-revalidate | - | - | 0 | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |
| /api/public/stalls/:stallSlug/menu | public, max-age=0, must-revalidate | - | public, s-maxage=10, stale-while-revalidate=10 | 0 | - | 無 |
| /staff/orders | private, no-cache, no-store, max-age=0, must-revalidate | - | - | 0 | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |
| /merchant/dashboard | private, no-cache, no-store, max-age=0, must-revalidate | - | - | 0 | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |

## 瀏覽器結果

| 路由 | 裝置 | TTFB | FCP | LCP | JS 傳輸 | 圖片傳輸 | Order Session |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| / | desktop | 18.9 ms | - | - | 155.4 KB | 0 B | - |
| / | android_mobile_synthetic_tw | 20.1 ms | 916 ms | 916 ms | 155.4 KB | 0 B | - |
| /login | desktop | 19.6 ms | 724 ms | 724 ms | 157.1 KB | 0 B | - |
| /login | android_mobile_synthetic_tw | 18.6 ms | 696 ms | 696 ms | 157.1 KB | 0 B | - |
| /onboarding | desktop | 19.2 ms | 664 ms | 664 ms | 157.1 KB | 0 B | - |
| /onboarding | android_mobile_synthetic_tw | 19 ms | 816 ms | 816 ms | 157.1 KB | 0 B | - |
| /api/health | desktop | 18.9 ms | 668 ms | 668 ms | 0 B | 0 B | - |
| /api/health | android_mobile_synthetic_tw | 20.3 ms | 232 ms | 232 ms | 0 B | 0 B | - |
| /q/:qrToken | desktop | 18.9 ms | 660 ms | 660 ms | 178.4 KB | 876 B | 588.8 ms |
| /q/:qrToken | android_mobile_synthetic_tw | 20.6 ms | 756 ms | 756 ms | 178.4 KB | 876 B | 276 ms |
| /api/public/stalls/:stallSlug/menu | desktop | 18.5 ms | 676 ms | 676 ms | 0 B | 0 B | - |
| /api/public/stalls/:stallSlug/menu | android_mobile_synthetic_tw | 20.3 ms | 216 ms | 216 ms | 0 B | 0 B | - |
| /staff/orders | desktop | 18.7 ms | 716 ms | 716 ms | 157.1 KB | 0 B | - |
| /staff/orders | android_mobile_synthetic_tw | 20.5 ms | 824 ms | 824 ms | 157.1 KB | 0 B | - |
| /merchant/dashboard | desktop | 20.3 ms | 692 ms | 692 ms | 157.1 KB | 0 B | - |
| /merchant/dashboard | android_mobile_synthetic_tw | 19.1 ms | 784 ms | 784 ms | 157.1 KB | 0 B | - |

## 預算警告

目前量測項目沒有觸發預算警告；未量測項目不視為通過。

## 限制

- 網際網路要求無法穩定強制 Vercel Serverless cold start，因此 cold-like 僅作第一筆比較。
- `x-vercel-id` 第一段是入口 Edge PoP，不是 Function 執行區；Function 區域須由 Vercel Deployment API 驗證。
- `Server-Timing` 尚未提供的細項會保留為空值，不以總時間猜測資料庫或外部服務耗時。
- 未提供測試憑證時，受保護路由只會量到重新導向或拒絕回應。
- `/staff/orders` 是需求中的概念路徑；專案實際店員訂單頁為 `/staff/:stallSlug`，可用 `PERFORMANCE_STAFF_PATH` 另外量測。

## P1 階段結論

| 路由 | Baseline warm 總時間 P75 | P0 | P1 | Baseline 至 P1 |
| --- | ---: | ---: | ---: | ---: |
| `/` | 255.4 ms | 111.9 ms | 31.4 ms | -87.7% |
| `/login` | 264.8 ms | 100.6 ms | 25.7 ms | -90.3% |
| `/api/health` | 1006.6 ms | 115.3 ms | 110.8 ms | -89.0% |

- 公開菜單 API cold-like 總時間 234.7 ms、warm P75 25.1 ms；warm 樣本皆為 `HIT`。
- QA QR 頁為 HTTP 200，warm P75 127.8 ms；Android 合成網路 LCP 756 ms，order session 276 ms。
- 首頁 Android LCP 本輪為 916 ms，高於 P0 的 664 ms；HTTP cache 改善明確，但單次瀏覽器 LCP 有波動，保留到 P3 以多輪與資產數據判斷，不把它解讀為快取退化或改善。
- Cookie 與 Authorization 探針均為 `private, no-store`，分別得到 `MISS` 與 `BYPASS`，未出現 shared-cache header。

## Staging 前置修正

第一次 QR 探針發現 Staging migration history 已登記到較新版本，但實體 schema 尚未包含 LINE 外送 contract。Runtime Log 的具體錯誤是缺少 `stall_ordering_settings.delivery_module_enabled`，因此先只在 Staging 補套 repository 既有的 `staff_pos_and_line_delivery` 與 `staff_pos_and_line_delivery_contract`，再從頭重測；Production 未在本階段變更。

量測資料使用隔離的 `stallorder-performance-qa` Staging 組織，只有虛構攤位與單一商品，未建立訂單。回復方式為刪除該組織，相關測試資料由外鍵連鎖清除；不得在 Production 建立同名 fixture。
