# 公開 QR 菜單快取

## 快取範圍

`src/lib/public-menu.ts` 使用 Next.js `unstable_cache`。本專案尚未全域啟用 Cache Components，因為既有多個 dynamic route 與 Next.js 16 Cache Components 設定不相容；採用目前穩定 API可避免擴大改動。

| 資料 | TTL | Tag |
| --- | ---: | --- |
| QR 到 stall／桌位的公開 context | 30 秒 | `public-qr:<sha256>` |
| stall 菜單、翻譯、註記與公開限制 | 45 秒 | `stall-menu:<stallId>` |

QR raw token 不會進入 tag、log 或量測輸出。公開頁可快取 stall 名稱、分類、商品、價格、描述、圖片、翻譯、註記群組、排序與公開訂購限制。

## 明確禁止快取

- Order session、cart、customer order status、付款、取餐碼。
- 已驗證的使用者 session、RBAC／RLS 結果。
- Rate-limit 判斷、Turnstile token、idempotency key。
- 顧客電話、地址或備註。

`create-public-order` Edge Function 仍會重新驗證 QR／session、正式商品供應與價格、數量限制、Turnstile、rate limit 與 idempotency。Client 顯示值永遠不是建立訂單的信任來源。

## 失效規則

下列成功寫入後立即呼叫 `revalidateTag(..., { expire: 0 })`：

- 商品新增、修改、停用、匯入、價格、排序、供應與售罄。
- 分類、註記群組／選項及翻譯。
- 攤位營業、點餐、售罄、模組與語系設定。
- QR 暫停、恢復、撤銷或 token rotate。
- 多攤位範本與批次點餐狀態。

組織共用商品／分類變更會失效該組織所有 stall menu；單攤位售罄只失效該 stall。即使某條異常寫入漏掉 tag，最長 stale window 仍限制在 45 秒，但此 TTL 不是正常失效機制的替代品。

## 首屏流程

1. Server Component 取得短 TTL 菜單並輸出首屏。
2. Client mount 後平行初始化 Turnstile 與一次性 10 分鐘 order session。
3. Session 尚未成功前，提交按鈕保持不可用。
4. 提交時 Edge Function執行完整安全與價格驗證。

快取永遠不會讓撤銷 QR 可成功下單；即使 30 秒內畫面仍顯示，session 建立與訂單提交的受信任流程都會拒絕。
