# PostgreSQL 查詢分析

## 方法

2026-07-19 以已驗證的 Production Supabase 專案讀取 `pg_stat_statements` 聚合資訊。紀錄僅保留去識別化的查詢家族與統計值，不包含 SQL 參數、顧客資料、token 或連線字串。

可重跑的唯讀查詢：

```sql
select
  calls,
  mean_exec_time,
  max_exec_time,
  total_exec_time,
  rows,
  query
from pg_stat_statements
where calls > 5
order by total_exec_time desc
limit 20;
```

## Production 快照

| 去識別化查詢家族 | Calls | Total ms | Mean ms | Max ms |
| --- | ---: | ---: | ---: | ---: |
| 到期未確認訂單 | 3,892 | 26,485.01 | 6.805 | 354.80 |
| 公開 rate-limit buckets | 151 | 600.33 | 3.976 | 未列入提交資料 |
| 營運警示刷新 | 29 | 508.69 | 17.541 | 未列入提交資料 |
| 建立訂單 session | 28 | 392.10 | 14.004 | 未列入提交資料 |
| 公開全域 gate | 29 | 190.85 | 6.581 | 未列入提交資料 |
| Auth session lookup | 236 | 117.85 | 0.499 | 未列入提交資料 |
| 公開攤位商品 | 67 | 105.81 | 1.579 | 未列入提交資料 |
| 組織 membership | 223 | 未列入提交資料 | 0.313 | 未列入提交資料 |
| 攤位 membership | 227 | 未列入提交資料 | 0.274 | 未列入提交資料 |
| 續接既有公開訂單 | 26 | 未列入提交資料 | 1.576 | 未列入提交資料 |
| 建立公開訂單 | 17 | 未列入提交資料 | 1.095 | 未列入提交資料 |
| 每日攤位摘要 | 34 | 未列入提交資料 | 0.258 | 未列入提交資料 |

最高總時間來自到期掃描的高呼叫頻率，不是持續性的單次慢查詢。對照 cron run history，可確認除了每分鐘資料庫排程外，request path 與重複排程還在額外觸發，因此 P2 優先移除重複呼叫。

## 資料量與索引決策

快照中的主要 Production 表仍屬低資料量：訂單為 0、訂單 session 約 18、公開嘗試約 26、rate-limit bucket 約 70、攤位商品約 3；每日摘要與營運警示為 0。現階段沒有足以證明範例複合索引能降低成本的實際 query plan。

本階段新增索引：**0**。

理由：

1. 目前主要 query mean time 均低，新增索引無法取得可信的 before/after 改善。
2. 訂單寫入、狀態轉換與 rate-limit 都是寫入敏感路徑，盲目加索引會增加寫入與儲存成本。
3. Dashboard 已使用有日期界線的 `daily_stall_summaries`，沒有把歷史訂單載入 Node.js 聚合。

## 後續 EXPLAIN 流程

只對 `pg_stat_statements` 顯示高總時間、P95 或單次最大時間的候選查詢執行：

```sql
begin;
explain (analyze, buffers, settings)
select ...
where organization_id = '<synthetic-uuid>'::uuid
  and stall_id = '<synthetic-uuid>'::uuid;
rollback;
```

檢查重點：Sequential Scan、rows removed by filter、sort spill、loops、RLS helper 重複執行與 join 順序。提交 query plan 前必須把識別值改成合成值。

只有在候選索引具備「支援查詢、before plan、after plan、量測改善、寫入/儲存成本、獨立 migration、rollback SQL」全部證據時才加入。

## 量測限制

目前 Production 尚無可代表正常營業週期的訂單資料，因此不能用此快照預測高峰負載。P3 完成後仍需在一個實際營業週期觀察 Vercel timing logs、Speed Insights 與 Supabase 指標，再重跑本分析。
