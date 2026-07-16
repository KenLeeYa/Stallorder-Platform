# Production Database 驗證

本文件同時適用 Staging 與 Production；必須先在 Staging 完整執行。Production 只做安全、可重複、非破壞性驗證。

## 目前本機基線

- 26 份 migration 可由空資料庫依序套用。
- 12 個 pgTAP 檔、224 個 assertions 全部通過。
- `supabase db lint --local --level warning --fail-on warning` 為 0 警告。
- 已偵測並審查一個 `DROP COLUMN`：`20260713000400_product_categories.sql` 先建立／回填 `product_categories` 與 `products.category_id`，再移除舊 `products.category`。
- 未發現 `DROP TABLE`、`TRUNCATE` 或不可逆 `ALTER COLUMN TYPE`。

本機通過不等於遠端通過；遠端狀態必須另行記錄。

## Migration history 與 drift

```powershell
npx supabase migration list --linked
npx supabase db push --linked --dry-run
```

驗收條件：

- Local／remote 已套版本順序一致，沒有 remote-only migration。
- Dry-run 只列出預期尚未套用版本；Production 套用完成後應無 pending migration。
- 不使用 `--include-all`、`migration repair` 或手動 SQL 來掩蓋 drift。
- Production 不使用 `--include-seed`。

## Schema、RLS 與 grants

以下 SQL 只讀；結果不符合預期即阻擋上線。

```sql
-- public 一般／分割表必須同時啟用並強制 RLS；預期 0 rows。
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity, c.relforcerowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and (not c.relrowsecurity or not c.relforcerowsecurity)
order by c.relname;

-- anon 不可直接寫 orders；預期 0 rows。
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'orders'
  and grantee = 'anon'
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE');

-- 檢視所有 anon/authenticated policy，逐項審查 ownership/membership predicate。
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and (roles::text like '%anon%' or roles::text like '%authenticated%')
order by tablename, policyname;

-- 檢查 SECURITY DEFINER；每一項都需有理由、固定 search_path 與最小 EXECUTE grant。
select n.nspname, p.proname, p.prosecdef,
       pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
order by p.proname;
```

## 必要隔離測試

| 情境 | 來源 | 預期 |
| --- | --- | --- |
| anon INSERT／SELECT orders | `security_hardening.test.sql`、`qr_order_abuse.test.sql` | denied |
| tracking token 跨訂單 | `qr_order_abuse.test.sql` | denied |
| staff 跨攤位 | `multi_stall_rls.test.sql` | denied |
| merchant 跨組織 | `multi_stall_rls.test.sql` | denied |
| kitchen 讀財務 | `multi_stall_rls.test.sql` | denied |
| finance viewer 修改訂單 | `multi_stall_rls.test.sql` | denied |
| inactive membership | `security_hardening.test.sql` | denied |
| suspended organization 接新單 | `qr_order_abuse.test.sql` | denied |

遠端驗證不得建立 Production demo account。需要 auth context 的測試先在 Staging 執行；Production 以受控、可刪除的 bootstrap identities 做最小驗證。

## Constraint、index、extension 與 Cron

```sql
select extname, extversion from pg_extension order by extname;
select schemaname, tablename, indexname from pg_indexes where schemaname = 'public' order by tablename, indexname;
select conrelid::regclass as table_name, conname, contype from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2;
select jobid, schedule, command, active from cron.job order by jobid;
```

確認 `pgcrypto`、`pg_cron`、所有 FK／check／unique、order/realtime/rate-limit indexes、未確認訂單逾時與每日摘要 Cron 存在且 active。

## Advisor 與正式結果

| 項目 | Staging | Production | 阻擋規則 |
| --- | --- | --- | --- |
| Migration history | 尚未建立專案 | 尚未建立專案 | 不一致即阻擋 |
| RLS／cross-tenant | 尚未執行 | 尚未執行 | 任一失敗即阻擋 |
| Security Advisor | 尚未執行 | 尚未執行 | critical/high 未解即阻擋 |
| Performance Advisor | 尚未執行 | 尚未執行 | 影響上線的 index／connection 問題即阻擋 |
| Backup／restore point | 不適用測試資料 | 尚未確認 | 無可用備份即阻擋 |

執行結果只記錄狀態、finding title 與修正版本；不得把 SQL 連線字串或 credentials 寫入本文件。
