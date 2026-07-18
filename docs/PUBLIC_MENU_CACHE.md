# 公開菜單快取

## 資料流

1. `/q/[qrToken]` 在伺服器讀取短效 QR context 與菜單 Data Cache。
2. 若 QR 與攤位目前可用，HTML 先顯示公開菜單。
3. Client 同步建立一次性短效 order session；完成前提交按鈕停用。
4. `create-public-order` Edge Function 仍重新驗證 QR/session、rate limit、Turnstile、價格、售罄、註記與數量限制。
5. Cache payload 永遠不是下單或付款的權威資料。

## Cache policy

| 資料 | Next.js cache | Tag | 說明 |
| --- | ---: | --- | --- |
| QR state、到期、桌位、攤位 ordering state | 15 秒 | `public-qr:<sha256>` | Tag 與文件不含 raw QR token |
| 商品、分類、價格、圖片、翻譯、註記與限制 | 45 秒 | `stall-menu:<stallId>` | 所有 mutation 成功後立即 revalidate |
| Anonymous `GET /api/public/stalls/:stallSlug/menu` | Vercel 15 秒 + SWR 15 秒 | 以上 Data Cache | 不含 QR、session、訂單、付款或 pickup code |

帶 `Cookie` 或 `Authorization` 的公開菜單 GET 會改為 `private, no-store, max-age=0`，不設定 shared-cache header。404 也保持 private/no-store，避免攤位恢復營業後仍被負快取。

## Stable／volatile split 決策

本階段不拆成兩個前端 payload。現有菜單資料量小，價格、售罄與產品結構通常同時顯示；拆分會增加一次 request、合併狀態與錯誤處理。採 45 秒 Data Cache、15 秒 CDN 與 mutation 即時失效，降低複雜度。若後續量測顯示 payload 或 invalidation churn 成為瓶頸，再以實際數據拆分 stable catalog 與 volatile availability。

CDN response 無法由目前 Next tag 立即 purge，最差可能在 15 秒 fresh 加 15 秒 SWR 內顯示舊 UI；下單 Edge Function 不信任快取，售罄、關閉、撤銷或價格變更仍立即阻止錯誤訂單。

## Invalidation matrix

| 變更 | Invalidation scope |
| --- | --- |
| 商品建立、單攤供應、售罄、價格 override | 目標 stall menu |
| 共用商品、分類、翻譯、註記群組、刪除 | Organization 內所有 stall menus |
| CSV import、catalog command | 所有已授權受影響 stalls |
| 攤位基本資料、營業／ordering state、sold-out | stall menu + 該 stall 所有 QR contexts |
| QR pause/resume/revoke/rotate | 舊 QR contexts + 新 token context + stall menu |
| 內用／外送／語系等 module 設定 | stall menu + 現有 QR contexts |
| 多攤位 batch pause/resume | 所選 stall menus + 所選 stalls QR contexts |
| 多攤位 template／商品供應複製 | 目標 stall menu |

入口實作位於 `src/app/api/merchant/**` 與 `src/app/api/stalls/**`；統一 tag helper 在 `src/lib/cache-tags.ts`，不得自行拼接 raw token。

## 測試

- Unit：tag 不含 raw QR token、stall 去重、organization invalidation、匿名/public 與 cookie/auth private policy。
- Playwright：匿名公開菜單 header、private bypass、菜單可先顯示、order session 未完成前不能提交。
- Deployment：連續請求同一路徑檢查 `X-Vercel-Cache` MISS/HIT、`Age`、三組 Cache-Control header 與無 `Set-Cookie`。

P1 Preview 實際結果會寫入 `docs/performance/P1_MEASUREMENT.md` 與 `performance-results/p1.json`。
