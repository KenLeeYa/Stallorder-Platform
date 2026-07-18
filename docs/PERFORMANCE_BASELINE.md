# StallOrder 效能基準

- 量測時間：2026-07-18T14:40:22.432Z
- 目標來源：https://stallorder-platform.vercel.app
- 每條路由要求數：6（第一筆為 cold-like，其餘為 warm）
- 驗證狀態：使用環境變數提供的測試帳號
- 隱私：未保存回應本文、Cookie、密碼、Session 或原始 QR Token。

> cold-like 是帶 `Cache-Control: no-cache` 的第一筆要求，不代表一定觸發 Vercel Function 真正冷啟動。Android 數據為 80ms RTT、4 Mbps 下載的合成網路。

## HTTP 結果

| 路由 | 狀態 | Cold TTFB | Cold 總時間 | Warm TTFB P75 | Warm 總時間 P75 | HTML/回應大小 | Vercel Edge PoP |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| / | 200 | 293.7 ms | 297.2 ms | 276.8 ms | 279.8 ms | 21.5 KB | hkg1 |
| /login | 200 | 252.7 ms | 255 ms | 273.1 ms | 273.8 ms | 12.2 KB | hkg1 |
| /onboarding | 307 | 2177.1 ms | 2179.4 ms | 1501.1 ms | 1501.3 ms | 8.6 KB | hkg1 |
| /api/health | 200 | 1044.6 ms | 1045.4 ms | 1006.1 ms | 1006.6 ms | 54 B | hkg1 |
| /q/:qrToken | 200 | 286.8 ms | 287.6 ms | 256.1 ms | 258.8 ms | 9.9 KB | hkg1 |
| /staff/orders | 404 | 2185.3 ms | 2185.8 ms | 2051.9 ms | 2053.1 ms | 9.3 KB | hkg1 |
| /staff/:stallSlug（實際路由） | 200 | 5904.6 ms | 5911.3 ms | 6639.9 ms | 6641.9 ms | 19.5 KB | hkg1 |
| /merchant/dashboard | 200 | 3678.7 ms | 3681.3 ms | 5211.7 ms | 5212.9 ms | 24.8 KB | hkg1 |

## 瀏覽器結果

| 路由 | 裝置 | TTFB | FCP | LCP | JS 傳輸 | 圖片傳輸 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| / | desktop | 18.8 ms | 688 ms | 688 ms | 155.5 KB | 0 B |
| / | android_mobile_synthetic_tw | 18.7 ms | 840 ms | 840 ms | 155.5 KB | 0 B |
| /login | desktop | 18.4 ms | 808 ms | 808 ms | 157 KB | 0 B |
| /login | android_mobile_synthetic_tw | 18.8 ms | 784 ms | 784 ms | 157 KB | 0 B |
| /onboarding | desktop | 18.8 ms | 2108 ms | 2108 ms | 157 KB | 0 B |
| /onboarding | android_mobile_synthetic_tw | 18.6 ms | 2052 ms | 2052 ms | 157 KB | 0 B |
| /api/health | desktop | 18.8 ms | 1332 ms | 1332 ms | 0 B | 0 B |
| /api/health | android_mobile_synthetic_tw | 18.5 ms | 1136 ms | 1136 ms | 0 B | 0 B |
| /q/:qrToken | desktop | 19.2 ms | 676 ms | 676 ms | 178.6 KB | 0 B |
| /q/:qrToken | android_mobile_synthetic_tw | 19.7 ms | 820 ms | 820 ms | 178.6 KB | 0 B |
| /staff/orders | desktop | 22.2 ms | 4400 ms | 4400 ms | 152.6 KB | 0 B |
| /staff/orders | android_mobile_synthetic_tw | 19 ms | 2772 ms | 2772 ms | 152.6 KB | 0 B |
| /staff/:stallSlug（實際路由） | desktop | 19 ms | 6836 ms | 6836 ms | 241.9 KB | 0 B |
| /staff/:stallSlug（實際路由） | android_mobile_synthetic_tw | 19 ms | 6472 ms | 6472 ms | 241.9 KB | 0 B |
| /merchant/dashboard | desktop | 18.5 ms | 8740 ms | 8740 ms | 232.3 KB | 0 B |
| /merchant/dashboard | android_mobile_synthetic_tw | 19 ms | 5676 ms | 5676 ms | 232.3 KB | 0 B |

## 預算警告

- /api/health: 暖要求總時間 P75 1006.6ms 超過 300ms 預算
- /staff/orders: 暖要求總時間 P75 2053.1ms 超過 1000ms 預算
- /staff/:stallSlug（實際路由）: 暖要求總時間 P75 6641.9ms 超過 1000ms 預算
- /merchant/dashboard: 暖要求總時間 P75 5212.9ms 超過 1500ms 預算

## 限制

- 網際網路要求無法穩定強制 Vercel Serverless cold start，因此 cold-like 僅作第一筆比較。
- `x-vercel-id` 第一段是入口 Edge PoP，不是 Function 執行區；Function 區域須由 Vercel Deployment API 驗證。
- `Server-Timing` 尚未提供的細項會保留為空值，不以總時間猜測資料庫或外部服務耗時。
- 未提供測試憑證時，受保護路由只會量到重新導向或拒絕回應。
- `/staff/orders` 是需求中的概念路徑；專案實際店員訂單頁為 `/staff/:stallSlug`，可用 `PERFORMANCE_STAFF_PATH` 另外量測。
