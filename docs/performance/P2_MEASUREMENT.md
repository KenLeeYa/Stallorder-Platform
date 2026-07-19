# StallOrder P2 效能量測

- 量測時間：2026-07-18T21:05:35.769Z
- 階段：p2
- 版本：380a18a3c7b6f0b8c086c981e4fd8b1c0637f551
- Function region：hnd1
- 目標來源：https://stallorder-platform-ojk3fffc8-ada76145-8663s-projects.vercel.app
- 每條路由要求數：6（第一筆為 cold-like，其餘為 warm）
- 驗證狀態：使用環境變數提供的測試帳號
- 隱私：未保存回應本文、Cookie、密碼、Session 或原始 QR Token。

> cold-like 是帶 `Cache-Control: no-cache` 的第一筆要求，不代表一定觸發 Vercel Function 真正冷啟動。Android 數據為 80ms RTT、4 Mbps 下載的合成網路。

## HTTP 結果

| 路由 | 狀態 | Cold DNS | Cold TCP | Cold TLS | Cold TTFB | Cold 總時間 | Warm TTFB P75 | Warm 總時間 P75 | 回應大小 | Cache | Edge PoP |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| / | 200 | 23.5 ms | 5.2 ms | 39.3 ms | 344.3 ms | 346 ms | 24.7 ms | 26.4 ms | 21.8 KB | HIT | hkg1 |
| /login | 200 | 0.3 ms | 7.3 ms | 37.7 ms | 439.7 ms | 440.8 ms | 23.6 ms | 24.4 ms | 12.5 KB | HIT | hkg1 |
| /onboarding | 307 | 0.4 ms | 5 ms | 47.6 ms | 471.4 ms | 473.7 ms | 145.1 ms | 145.5 ms | 8.7 KB | MISS | hkg1 |
| /api/health | 200 | 0.3 ms | 6.2 ms | 36.9 ms | 195.6 ms | 195.6 ms | 107.8 ms | 107.9 ms | 54 B | MISS | hkg1 |
| /q/:qrToken | 200 | 0.6 ms | 7.9 ms | 38.1 ms | 367.5 ms | 369.6 ms | 120.8 ms | 123.3 ms | 15.8 KB | MISS | hkg1 |
| /api/public/stalls/:stallSlug/menu | 200 | 0.5 ms | 7.6 ms | 37.5 ms | 312.7 ms | 390.2 ms | 141.6 ms | 157.5 ms | 558 B | MISS | hkg1 |
| /staff/orders | 404 | 0.7 ms | 5.2 ms | 37.5 ms | 278.6 ms | 280.8 ms | 160.2 ms | 161.4 ms | 9.4 KB | MISS | hkg1 |
| /staff/:stallSlug（實際路由） | 200 | 0.4 ms | 7.8 ms | 37.5 ms | 368.6 ms | 371.5 ms | 264.5 ms | 266.9 ms | 17.9 KB | MISS | hkg1 |
| /merchant/dashboard | 200 | 0.5 ms | 5.8 ms | 48.6 ms | 268.7 ms | 271.2 ms | 198.2 ms | 200.4 ms | 24.8 KB | MISS | hkg1 |
| /merchant/reports（實際路由） | 200 | 0.4 ms | 7.7 ms | 35.7 ms | 686.6 ms | 693.9 ms | 214.9 ms | 222.1 ms | 45.1 KB | MISS | hkg1 |

## Cache headers

| 路由 | Cache-Control | Vercel-CDN-Cache-Control | CDN-Cache-Control | Age | Vary | Set-Cookie |
| --- | --- | --- | --- | ---: | --- | --- |
| / | public, max-age=0, must-revalidate | - | public, s-maxage=600, stale-while-revalidate=3600 | 30 | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |
| /login | public, max-age=0, must-revalidate | - | public, s-maxage=60, stale-while-revalidate=300 | 0 | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |
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
| / | desktop | 18.7 ms | 3596 ms | 3596 ms | 155.4 KB | 0 B | - |
| / | android_mobile_synthetic_tw | 19.7 ms | 648 ms | 648 ms | 155.4 KB | 0 B | - |
| /login | desktop | 18.8 ms | 636 ms | 636 ms | 157.1 KB | 0 B | - |
| /login | android_mobile_synthetic_tw | 18.6 ms | 684 ms | 684 ms | 157.1 KB | 0 B | - |
| /onboarding | desktop | 18.8 ms | 656 ms | 656 ms | 157.1 KB | 0 B | - |
| /onboarding | android_mobile_synthetic_tw | 19.5 ms | 844 ms | 844 ms | 157.1 KB | 0 B | - |
| /api/health | desktop | 18.8 ms | 600 ms | 600 ms | 0 B | 0 B | - |
| /api/health | android_mobile_synthetic_tw | 19.5 ms | 232 ms | 232 ms | 0 B | 0 B | - |
| /q/:qrToken | desktop | 19.8 ms | 664 ms | 664 ms | 178.4 KB | 876 B | 3445.3 ms（HTTP 201） |
| /q/:qrToken | android_mobile_synthetic_tw | 19.2 ms | 796 ms | 796 ms | 178.4 KB | 876 B | 714.8 ms（HTTP 201） |
| /api/public/stalls/:stallSlug/menu | desktop | 18.4 ms | 616 ms | 616 ms | 0 B | 0 B | - |
| /api/public/stalls/:stallSlug/menu | android_mobile_synthetic_tw | 18.8 ms | 280 ms | 280 ms | 0 B | 0 B | - |
| /staff/orders | desktop | 19.1 ms | 660 ms | 660 ms | 152.6 KB | 0 B | - |
| /staff/orders | android_mobile_synthetic_tw | 20.6 ms | 864 ms | 864 ms | 152.6 KB | 0 B | - |
| /staff/:stallSlug（實際路由） | desktop | 18.9 ms | 640 ms | 640 ms | 241.8 KB | 0 B | - |
| /staff/:stallSlug（實際路由） | android_mobile_synthetic_tw | 18.6 ms | 972 ms | 972 ms | 241.8 KB | 0 B | - |
| /merchant/dashboard | desktop | 18.6 ms | 744 ms | 744 ms | 232.2 KB | 0 B | - |
| /merchant/dashboard | android_mobile_synthetic_tw | 20.1 ms | 1148 ms | 1148 ms | 232.2 KB | 0 B | - |
| /merchant/reports（實際路由） | desktop | 19 ms | 660 ms | 660 ms | 162.6 KB | 0 B | - |
| /merchant/reports（實際路由） | android_mobile_synthetic_tw | 18.6 ms | 808 ms | 808 ms | 162.6 KB | 0 B | - |

## 預算警告

- /q/:qrToken: desktop order session 3445.3ms 超過 800ms 預算

## P1 與 P2 比較

下表比較相同 Preview 量測腳本、相同測試帳號與相同 6 次取樣方法的 warm 總時間 P75。數值下降代表較快；網際網路抖動與 Serverless instance 狀態仍會影響單輪結果。

| 路由 | P1 | P2 | 差異 | 判讀 |
| --- | ---: | ---: | ---: | --- |
| `/` | 33.5 ms | 26.4 ms | -7.1 ms | 改善 |
| `/login` | 25.1 ms | 24.4 ms | -0.7 ms | 持平 |
| `/onboarding` | 135.7 ms | 145.5 ms | +9.8 ms | 小幅波動 |
| `/api/health` | 130.4 ms | 107.9 ms | -22.5 ms | 改善 |
| `/q/:qrToken` | 129.0 ms | 123.3 ms | -5.7 ms | 小幅改善 |
| `/api/public/stalls/:stallSlug/menu` | 146.2 ms | 157.5 ms | +11.3 ms | 小幅波動；登入量測會刻意繞過公開 CDN 快取 |
| `/staff/:stallSlug` | 249.0 ms | 266.9 ms | +17.9 ms | 單輪未改善 |
| `/merchant/dashboard` | 189.3 ms | 200.4 ms | +11.1 ms | 單輪未改善 |
| `/merchant/reports` | 205.6 ms | 222.1 ms | +16.5 ms | 單輪未改善 |

P2 前一次相同 Preview 的觀測曾得到店員 216.1 ms、儀表板 188.2 ms、報表 182.0 ms，顯示這些約 10–40 ms 的差異尚在網路與 instance 抖動範圍。最終報告採用上表這次固定量測，不挑選較好的一輪。冷啟動樣本中儀表板從 629.5 ms 降至 268.7 ms，但 cold-like 無法保證兩次都觸發真正冷啟動，因此不將這個差異宣稱為穩定改善。

## 查詢與 Edge 證據

- `QrOrderFlow` 已有 P1 初始菜單時，session 資料庫查詢數由 16–18 次降為 8 次；官方價格、售罄、註記、數量限制與一次性 session 仍在建立訂單時由伺服器重新驗證。
- P2 runtime log 的店員頁為 10 次資料庫查詢；儀表板與報表各為 7 次。單筆 warm 應用層時間約為店員 96.6–121.8 ms、儀表板 100.2–111.3 ms、報表 106.4–111.0 ms，剩餘端到端時間包含 Vercel 入口、傳輸與瀏覽器工作。
- 兩次 `create-order-session` 都成功回傳 HTTP 201。Supabase Edge 執行時間分別是 3,278 ms（首次）與 507 ms（後續），瀏覽器觀測為 3,445.3 ms 與 714.8 ms；Preview 同源代理約增加 167–208 ms，首次超標主要發生在 Edge 冷啟動內。
- P1 量測器尚未記錄 session HTTP status，且舊 Preview origin 不在 Edge CORS allowlist，因此 P1 的 577.8 ms／282.0 ms 不可作為成功 session 的基準。P2 改用現有同源受信任代理並把 status 納入結果，避免把拒絕回應誤判成快速成功。
- Production 自訂網域仍直接呼叫 Supabase Edge，不經上述 Preview 同源代理；P2 沒有為效能放寬 CORS、QR session、RLS、Turnstile、rate limit 或價格驗證。

## P2 結論

P2 已完成可由程式碼與測試證明的查詢瀑布、request 內重複 session 解析、集合式寫入與重複排程修正。小型 Staging fixture 無法重現大型歷史資料聚合負載，warm P75 也沒有對所有受保護頁面呈現一致下降，因此本階段不新增未經 query plan 證明的索引，也不宣稱整體響應時間全面改善。剩餘最明確瓶頸是 Supabase Edge 首次冷啟動；P3 僅處理圖片、前端載入、loading UI 與瀏覽器可觀測性，不以 UI 優化掩蓋此後端限制。

## 限制

- 網際網路要求無法穩定強制 Vercel Serverless cold start，因此 cold-like 僅作第一筆比較。
- `x-vercel-id` 第一段是入口 Edge PoP，不是 Function 執行區；Function 區域須由 Vercel Deployment API 驗證。
- `Server-Timing` 尚未提供的細項會保留為空值，不以總時間猜測資料庫或外部服務耗時。
- 未提供測試憑證時，受保護路由只會量到重新導向或拒絕回應。
- `/staff/orders` 是需求中的概念路徑；專案實際店員訂單頁為 `/staff/:stallSlug`，可用 `PERFORMANCE_STAFF_PATH` 另外量測。
