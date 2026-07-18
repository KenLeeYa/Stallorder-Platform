# PostgreSQL 效能分析 Runbook

## Top statements

在 Supabase SQL Editor 以受授權維運角色執行，匯出前移除 literal 與客戶識別資料：

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

本次 Production snapshot：`expire_unconfirmed_orders()` 3,457 calls，mean 6.65 ms、max 78.91 ms、total 22,975 ms；`issue_order_session` mean 15.29 ms；auth 相關約 0.2–1.98 ms；公開商品／分類約 0.54 ms；rate-limit bucket insert 約 4.43 ms。SQL 本身不足以解釋 5–6 秒頁面，跨區與多輪 serial round trip 才是主要瓶頸。

## Candidate query analysis

只在 Staging 以去識別／合成值執行：

```sql
explain (analyze, buffers, settings, format text)
select ...
from ...
where organization_id = '<synthetic-uuid>'::uuid
  and stall_id = '<synthetic-uuid>'::uuid;
```

逐項檢查：

- Sequential Scan 是否掃描大量 rows。
- Rows Removed by Filter 是否遠高於輸出。
- Sort Method 是否 spill to disk。
- Nested Loop 的 loops 是否形成 N+1。
- Index Scan 是否選到低選擇性／錯誤欄位順序。
- RLS helper 是否每 row 重複執行，可否改成 init-plan 形式而不改權限語意。

## 新索引門檻

只有在 representative Staging data 的 before plan 證明 scan／sort 成本後才建立新 migration，並附：支援查詢、before/after plan、index size、寫入成本與 rollback：

```sql
drop index concurrently if exists public.<index_name>;
```

不可修改已套用 migration；`create index concurrently` 也不可放在 transaction block。Production 套用前須先完成 RLS／cross-tenant regression。
