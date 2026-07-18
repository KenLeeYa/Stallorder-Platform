# 資料庫查詢最佳化

## 範圍與原則

P2 僅修改已量測或由程式碼可證明的查詢瀑布與 N+1。所有查詢仍由伺服器端授權結果取得 `organizationId` 與 `stallId`，沒有接受前端提供的租戶範圍，也沒有停用 RLS、RBAC、CSRF、稽核或訂單狀態檢查。

## 已平行化的獨立查詢

| 路徑 | 修改前 | 修改後 | 查詢數變化 |
| --- | --- | --- | --- |
| `src/app/api/auth/login/route.ts` | 建立 session 後才載入 workspace；成功稽核後才更新最後登入時間 | 兩組各自使用 `Promise.all` | 數量不變，4 個串行階段降為 2 個 |
| `src/app/auth/callback/route.ts` | OAuth callback 依序載入 workspace、建立 session | 兩項並行，維持原計時欄位 | 數量不變，2 個階段降為 1 個 |
| `src/lib/dashboard-data.ts` | 摘要、警示刷新、警示查詢形成 3 段瀑布 | 摘要與「刷新後讀取警示」並行 | 數量不變，關鍵路徑 3 段降為 2 段 |
| `supabase/functions/create-order-session/index.ts` | 商品/分類/翻譯完成後才查註記指派 | 4 項獨立查詢同批執行 | 數量不變，2 段降為 1 段 |
| `supabase/functions/get-public-order/index.ts` | 設定與同桌最近訂單依序查詢 | 兩項並行 | 數量不變，2 段降為 1 段 |

`src/lib/auth.ts` 與 `src/lib/workspace.ts` 使用 React request cache，避免同一 Server Component render tree 重複解析相同 principal/workspace。快取只存在單一 request render 範圍，不是跨使用者的公開資料快取。

## 已移除的 N+1

| 寫入路徑 | 修改前 | 修改後 |
| --- | --- | --- |
| 商品供應複製 | 讀取來源後執行 N 次 `upsert` | 1 次具組織與攤位條件的 `INSERT ... SELECT ... ON CONFLICT` |
| 多攤位商品供應範本 | 更新未選商品後執行 N 次 `upsert` | 更新後 1 次集合式複製 |
| 內用桌位平面座標 | 1 次擁有權 count + N 次 update | 1 次 `UPDATE ... FROM jsonb_to_recordset`；筆數不符即拋錯並回滾交易 |
| CSV 商品匯入 | 每列查分類/群組、寫商品、逐語系寫翻譯、逐攤位寫供應 | 以批次分類/群組、JSON recordset 商品、翻譯及供應操作處理 |

CSV 套用的資料庫呼叫上限由約 `O(列數 × (語系數 + 攤位數))` 改為最多約 11 次固定批次操作，不含套用後既有的目錄回傳查詢。新增與更新仍在單一 Prisma transaction 中，任何分類、群組、商品或攤位歸屬異常都會整批回滾。

Edge Function 的菜單組裝也預先建立商品、翻譯、註記群組與選項索引，將重複 `filter`/`find` 掃描改為 Map lookup；這不改變資料庫查詢或官方價格驗證。

當 QR/外送頁面已取得 P1 的伺服器端快取菜單時，`QrOrderFlow` 會要求 `includeMenu: false`。Edge Function 仍依序執行 global gate、續接訂單、QR session 發行、ordering mode、QR/攤位/設定及桌位驗證，但不再重傳同一份商品、翻譯與註記資料。本機實際 QR 流程的 session `dbQueryCount` 由 16–18 降為 8；沒有初始菜單的相容客戶端仍可使用預設 `includeMenu: true` 取得完整資料。建立訂單時仍由 `create-public-order` 重新讀取官方價格、售罄、註記與數量限制。

## 到期訂單掃描

下列 request path 不再額外呼叫 `expire_unconfirmed_orders()`：

- `src/app/staff/[stallSlug]/page.tsx`
- `src/app/staff/[stallSlug]/floor/page.tsx`
- `src/app/api/stalls/[stallSlug]/orders/route.ts`
- `src/app/api/stalls/[stallSlug]/orders/[orderId]/route.ts`
- `supabase/functions/create-order-session/index.ts`
- `supabase/functions/get-public-order/index.ts`

資料庫原生 `pg_cron` 仍每分鐘執行一次。訂單確認 API 本身仍使用條件式狀態更新阻止逾時訂單被確認，因此排程最長約一分鐘的顯示延遲不會繞過狀態機。

## 刻意保留的順序

- `src/app/api/stalls/[stallSlug]/order-items/batch/route.ts`：逐項檢查前態、寫稽核快照並維持可復原狀態，不能無條件並行。
- `src/lib/report-delivery.ts`：逐排程鎖定、冪等鍵及外部寄送副作用需要確定順序。
- 訂單確認、結帳、現金交班與列印佇列中的 transaction lock/state transition：前一步結果是後一步前提。

## 驗證

- TypeScript：通過。
- ESLint：通過。
- Vitest：43 個檔案、160 項通過。
- pgTAP：16 個檔案、264 項通過，包含 RLS 與 QR 防濫用。
- Playwright：集合式 CSV 新增/更新、翻譯、供應及去重案例通過。
