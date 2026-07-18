# 查詢優化

## 已變更路徑

| 路徑 | 修改前 | 修改後 | SQL 數量／critical path |
| --- | --- | --- | --- |
| `src/app/merchant/layout.tsx` + dashboard | Layout／Page 重複 session、workspace | React request cache 去重 | 同一 RSC request 各一次 |
| `src/lib/dashboard-data.ts` | summary 後再 refresh alert、再讀 alert | summary 與 refresh→read 鏈平行 | SQL 數量不變，critical path 由 3 階降為 2 階 |
| `src/app/staff/[stallSlug]/page.tsx` | request 內先 RPC 逾期，再查 6 組初始資料 | 逾期交給每分鐘 pg_cron；6 組獨立查詢平行 | 每次頁面少 1 次 DB round trip |
| `src/app/api/stalls/:slug/orders` GET | 每次輪詢先 RPC 逾期 | 直接查清單，逾期由 pg_cron | 每次輪詢少 1 次 DB round trip |
| `src/app/api/auth/login` | session／workspace、audit／last-login 串行 | 各組獨立操作以 `Promise.all` 平行 | SQL 數量不變，減少跨區等待 |
| 多攤位商品複製 | 查來源後逐品 `upsert` | 單一參數化 `INSERT ... SELECT ... ON CONFLICT` | `N + 1` DML 降為 1 DML |
| 多攤位營運範本 | 商品供應逐品 `upsert` | 單一 set-based upsert，另保留停用目標多餘商品 | `N` DML 降為 1 DML |
| CSV catalog apply | 每列查分類／群組、寫商品、5 語翻譯及逐 stall upsert | 分類、群組、商品、翻譯、移除翻譯與 stall assignment 分批集合處理 | 由 O(row × locale × stall) 降為固定數量 SQL |
| Edge 公開菜單組裝 | 多次 `filter()`／`find()` | 預先建立 Map | SQL 不變，Node／Deno 組裝由重複掃描降為線性 |
| workspace／dashboard 組裝 | 每 stall 重複 filter | Map 分組 | SQL 不變，JS 由 O(stall × row) 降為 O(stall + row) |

交易順序、共享 lock、建立訂單與付款流程沒有被平行化。

## Dashboard aggregation

`src/lib/dashboard-data.ts` 使用 `daily_stall_summaries` 與 bounded date range，沒有下載全部歷史 orders／payments 到 Node.js。總營收、訂單數、付款差異與取消數由 PostgreSQL summary rows 聚合。多攤位比較一次取得範圍內資料，再以 Map 對應 stall。

## 索引判斷

Production `pg_stat_statements` 顯示目前應用查詢大多低於 5 ms；在尚無 anonymized `EXPLAIN (ANALYZE, BUFFERS)` 證明前，本分支不新增猜測性 index。這避免重複索引、額外寫入成本、VACUUM 壓力與 migration lock 風險。

## 安全不變量

- 查詢仍從 server-side membership 推導 organization／stall，沒有接受 client `tenant_id`。
- 所有 exposed table 的 RLS 與既有 RPC authorization 不變。
- 原子交易、idempotency、CSRF、rate limit、Turnstile 與 audit 寫入未移除。
