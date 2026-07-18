# Next.js Rendering 策略

## Layout 邊界

`src/app/layout.tsx` 只提供 metadata、全域樣式、PWA runtime 與已去識別的 Vercel monitoring；不呼叫 `cookies()`、`headers()`、session helper 或 Prisma。商家身份驗證位於 `src/app/merchant/layout.tsx`，店員頁在其 route 內驗證。

因此本次不進行高風險的大規模 Route Group 搬移，現有 URL 完全不變。`src/app/page.tsx` 已移除不必要的 `force-dynamic`，首頁可由 Next.js 靜態輸出。

## Request 內去重

`src/lib/auth.ts#getPagePrincipal`、`src/lib/workspace.ts#getWorkspaceAccess` 與 `requireWorkspacePage` 使用 React `cache()`。同一個 RSC request 中 Layout 與 Page 的身份／workspace 查詢只執行一次；cache 不跨 request、也不公開快取登入資料。

## 各類頁面

| 類型 | 策略 |
| --- | --- |
| `/` | 靜態輸出 |
| `/login` | 無 DB 的公開頁，可預渲染 |
| `/q/:qrToken` | 動態 capability URL；只快取短 TTL 公開菜單資料 |
| `/order/:trackingToken` | 動態且不可公開快取 |
| `/merchant/**` | 動態、authenticated |
| `/staff/**`、`/kitchen/**` | 動態、authenticated／realtime |

## Loading 與 streaming

已加入 QR、店員訂單、商家儀表板與報表的 route-level skeleton。Loading UI 不改變身份判斷，也不取代後端效能改善。

## Build 驗證

`npm run build` 的 route table 必須顯示 `/` 為 static；所有含 session、token、訂單或付款資料的頁面仍保持 dynamic。若未來啟用 Cache Components，需先移除或改寫既有多個 `force-dynamic` segment，不能直接全域切換。
