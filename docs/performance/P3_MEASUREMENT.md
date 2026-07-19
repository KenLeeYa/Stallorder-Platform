# StallOrder 效能基準

- 量測時間：2026-07-18T21:37:18.157Z
- 階段：p3
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
| / | 200 | 23.6 ms | 5.4 ms | 38.2 ms | 332.9 ms | 334.8 ms | 270.4 ms | 272.1 ms | 22.2 KB | HIT | hkg1 |
| /login | 200 | 0.3 ms | 4.8 ms | 36.4 ms | 1151.4 ms | 1160.6 ms | 25.8 ms | 26.5 ms | 12.8 KB | HIT | hkg1 |
| /onboarding | 307 | 0.4 ms | 7.6 ms | 36.5 ms | 437.6 ms | 440.7 ms | 159.9 ms | 167.4 ms | 8.8 KB | MISS | hkg1 |
| /api/health | 200 | 0.4 ms | 258.2 ms | 39 ms | 417.5 ms | 417.6 ms | 113.6 ms | 113.7 ms | 54 B | MISS | hkg1 |
| /q/:qrToken | 200 | 0.8 ms | 6.3 ms | 37.4 ms | 203 ms | 351.8 ms | 125.6 ms | 157.7 ms | 22.6 KB | MISS | hkg1 |
| /api/public/stalls/:stallSlug/menu | 200 | 0.4 ms | 15301.8 ms | 35.9 ms | 15506.3 ms | 15547.8 ms | 126.4 ms | 163.1 ms | 558 B | MISS | hkg1 |
| /staff/orders | 404 | 3.6 ms | 5.2 ms | 35.5 ms | 219.3 ms | 222.7 ms | 145.5 ms | 147.5 ms | 9.4 KB | MISS | hkg1 |
| /staff/:stallSlug（實際路由） | 200 | 0.5 ms | 265.8 ms | 36.1 ms | 464.7 ms | 532.8 ms | 374.4 ms | 409 ms | 24 KB | MISS | hkg1 |
| /merchant/dashboard | 200 | 1 ms | 6.1 ms | 36.4 ms | 625.2 ms | 629.8 ms | 175.1 ms | 177.6 ms | 26.4 KB | MISS | hkg1 |
| /merchant/reports（實際路由） | 200 | 0.9 ms | 7.7 ms | 35.9 ms | 225.1 ms | 296.8 ms | 202.7 ms | 244.2 ms | 51.5 KB | MISS | hkg1 |

## Cache headers

| 路由 | Cache-Control | Vercel-CDN-Cache-Control | CDN-Cache-Control | Age | Vary | Set-Cookie |
| --- | --- | --- | --- | ---: | --- | --- |
| / | public, max-age=0, must-revalidate | - | public, s-maxage=600, stale-while-revalidate=3600 | 184 | rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch | 無 |
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
| / | desktop | 21 ms | 4408 ms | 4408 ms | 157.7 KB | 0 B | - |
| / | android_mobile_synthetic_tw | 19.2 ms | 1484 ms | 1484 ms | 164.2 KB | 0 B | - |
| /login | desktop | 18.8 ms | 656 ms | 656 ms | 165.8 KB | 0 B | - |
| /login | android_mobile_synthetic_tw | 19.3 ms | 672 ms | 672 ms | 159.3 KB | 0 B | - |
| /onboarding | desktop | 19.1 ms | 624 ms | 624 ms | 165.8 KB | 0 B | - |
| /onboarding | android_mobile_synthetic_tw | 20.2 ms | 1104 ms | 1104 ms | 165.8 KB | 0 B | - |
| /api/health | desktop | 18.9 ms | 772 ms | 772 ms | 0 B | 0 B | - |
| /api/health | android_mobile_synthetic_tw | 679.7 ms | 804 ms | 804 ms | 0 B | 0 B | - |
| /q/:qrToken | desktop | 21 ms | 748 ms | 748 ms | 186.8 KB | 876 B | 2499.4 ms（HTTP 201） |
| /q/:qrToken | android_mobile_synthetic_tw | 19.4 ms | 744 ms | 744 ms | 186.8 KB | 876 B | 663.7 ms（HTTP 201） |
| /api/public/stalls/:stallSlug/menu | desktop | 28.9 ms | 3516 ms | 3516 ms | 0 B | 0 B | - |
| /api/public/stalls/:stallSlug/menu | android_mobile_synthetic_tw | 19.4 ms | 568 ms | 568 ms | 0 B | 0 B | - |
| /staff/orders | desktop | 19.4 ms | 1264 ms | 1264 ms | 161.3 KB | 0 B | - |
| /staff/orders | android_mobile_synthetic_tw | 19.8 ms | 1152 ms | 1152 ms | 161.3 KB | 0 B | - |
| /staff/:stallSlug（實際路由） | desktop | 19.6 ms | 864 ms | 864 ms | 186.6 KB | 0 B | - |
| /staff/:stallSlug（實際路由） | android_mobile_synthetic_tw | 19.9 ms | 768 ms | 768 ms | 186.6 KB | 0 B | - |
| /merchant/dashboard | desktop | 19 ms | 976 ms | 976 ms | 177 KB | 0 B | - |
| /merchant/dashboard | android_mobile_synthetic_tw | 18.6 ms | 744 ms | 744 ms | 177 KB | 0 B | - |
| /merchant/reports（實際路由） | desktop | 19.2 ms | 824 ms | 960 ms | 171.4 KB | 0 B | - |
| /merchant/reports（實際路由） | android_mobile_synthetic_tw | 19 ms | 1136 ms | 1136 ms | 171.4 KB | 0 B | - |

## 預算警告

- /q/:qrToken: desktop order session 2499.4ms 超過 800ms 預算

## 暖機確認與 P2 對照

同一個 Preview 在首次 P3 量測後立即再跑一輪，原始結果保留於
`performance-results/p3-confirmation.json`，人類可讀投影保留於
`docs/performance/P3_CONFIRMATION.md`。下表使用第二輪確認值，避免把首次部署的
Function／Edge 冷啟動誤算為前端改動效果。

| 路由 | P2 warm P75 | P3 warm P75 | P2 mobile LCP | P3 mobile LCP | 初始 JS 差異 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/` | 26.4 ms | 25.4 ms | 648 ms | 800 ms | +8,975 B |
| `/q/:qrToken` | 123.3 ms | 146.5 ms | 796 ms | 732 ms | +8,533 B |
| `/staff/:stallSlug` | 266.9 ms | 239.9 ms | 972 ms | 792 ms | -56,590 B |
| `/merchant/dashboard` | 200.4 ms | 187.5 ms | 1,148 ms | 744 ms | -56,594 B |
| `/merchant/reports` | 222.1 ms | 215.4 ms | 808 ms | 784 ms | +8,951 B |

- 店員頁與商戶儀表板的約 56.6 KB 初始 JS 降幅可直接歸因於延後載入 Supabase Realtime；兩頁 mobile LCP 也分別改善 180 ms 與 404 ms。
- 公開頁與報表增加約 8.5 至 9 KB，來源是本階段要求加入的 Vercel Analytics／Speed Insights。公開路由的 TTFB 沒有可證明的改善，不把網路波動解讀為程式優化。
- 首輪 `/` warm 中位數為 25.9 ms，但單一長尾把 P75 拉到 272.1 ms；首輪 public menu 的 15.5 秒 cold-like 時間發生在應用程式執行前，同時段 Vercel 應用層紀錄僅 25.2 至 42.9 ms。第二輪恢復正常，因此保留為部署冷啟動／網路離群值，而非回退修正。
- P3 未修改 `create-order-session` Edge Function。第二輪 desktop 1,174.5 ms、mobile 767.8 ms；desktop 仍超過 800 ms 預算，不能把這段波動列為 P3 成果。

## 圖片與行動版 QA

- 影像處理的隔離測試將 1,600 x 1,200、1,948,131 B JPEG 轉為 800 x 600、179,346 B WebP，縮減 90.8%，符合 100 至 200 KB 商品縮圖目標。
- Pixel 7、`zh-TW` Preview QA 驗證 QR 菜單與商戶儀表板均無水平溢位；QR 商品圖 1/1 完整載入，測試帳號可登入，hydration error 為 0。
- QR order session 最終回傳 HTTP 201，10 秒後不再顯示建立中狀態。瀏覽器觀察到 2 筆 CSP console error，但沒有 hydration、Realtime 或一般 network error；後續正式發布前仍須在未經 Vercel 分享頁注入的環境複驗 CSP。
- Preview 未觀察到 `/_vercel/*` 遙測 request。URL 去識別單元測試已通過，元件也已掛載，但 Vercel 儀表板是否開始收樣仍列為發布後人工驗證，不宣稱已收到 RUM 資料。

## 安全邊界

- Turnstile 僅延後下載與呈現，公開訂單仍由 Edge Function 在伺服器驗證 token、價格、QR session、rate limit 與 idempotency。
- 店員 SSE 失敗時才載入既有 Realtime fallback；登入、RBAC、RLS 與攤位範圍判斷未移到瀏覽器。
- Analytics URL 在送出前移除 query、hash、QR／tracking／invitation token 與租戶、攤位識別路徑；未加入顧客或訂單內容事件。

## 限制

- 網際網路要求無法穩定強制 Vercel Serverless cold start，因此 cold-like 僅作第一筆比較。
- `x-vercel-id` 第一段是入口 Edge PoP，不是 Function 執行區；Function 區域須由 Vercel Deployment API 驗證。
- `Server-Timing` 尚未提供的細項會保留為空值，不以總時間猜測資料庫或外部服務耗時。
- 未提供測試憑證時，受保護路由只會量到重新導向或拒絕回應。
- `/staff/orders` 是需求中的概念路徑；專案實際店員訂單頁為 `/staff/:stallSlug`，可用 `PERFORMANCE_STAFF_PATH` 另外量測。
