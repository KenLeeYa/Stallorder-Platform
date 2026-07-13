# StallOrder 多攤位資料遷移計畫

本文件適用於從單一商戶模型遷移至 `Organization -> Stall` 架構。正式環境只能透過版本化 migration 執行，不得手動改寫營運資料。

## 遷移範圍

- `tenants` 重新命名為 `organizations`，既有 UUID 保持不變。
- `user_accounts` 重新命名為 `profiles`，並以 `auth_user_id` 對應 Supabase Auth。
- 新增 `organization_memberships`，既有 owner 轉為 `ORGANIZATION_OWNER`。
- 既有 manager 轉為 `STALL_MANAGER`；staff 與 kitchen 保留原攤位指派。
- 所有既有訂單、商品、QR、稽核及防濫用資料回填 `organization_id`。
- 相容期保留 `tenant_id`，由資料庫 trigger 強制與 `organization_id` 相同。新應用程式只使用 `organization_id`。

## 上線前備份

1. 停止 schema 變更與批次匯入，記錄目前應用版本與 migration 版本。
2. 以 Supabase Dashboard 建立 Point-in-Time Recovery 檢查點；沒有 PITR 時執行完整邏輯備份。
3. 另行匯出 `tenants`、`stalls`、`user_accounts`、memberships、products、orders、order_items、qr_codes。
4. 保存 row count、每個 tenant 的訂單總額與最新訂單時間，作為遷移後核對基準。
5. 先在與正式環境同版本的 staging 備份副本執行完整 migration、RLS 與應用 smoke test。

範例備份指令中的連線字串必須由祕密管理服務注入，不得寫入 repository：

```bash
pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" > stallorder-pre-multi-stall.dump
```

## 執行順序

1. 部署可同時讀取新 schema、保留舊 Edge RPC 相容性的應用版本。
2. 套用 `20260713000500_multi_stall_role_enums.sql`。
3. 套用 `20260713000510_multi_stall_foundation.sql`。
4. 驗證回填、membership、foreign key、RLS 與 row count。
5. 部署只寫入 `organization_id/profile_id` 的應用版本。
6. 執行 customer QR、店員確認、取餐驗證、現金結帳與報表 smoke test。
7. 觀察錯誤率、授權拒絕、登入失敗與 audit write failure 至少一個營業尖峰。

## 資料驗證

以下查詢結果都必須為 `0`：

```sql
select count(*) from public.stalls where organization_id <> tenant_id;

select count(*)
from public.orders o
join public.stalls s on s.id = o.stall_id
where o.organization_id <> s.organization_id;

select count(*)
from public.products p
join public.stalls s on s.id = p.stall_id
where p.organization_id <> s.organization_id;

select count(*)
from public.qr_codes q
join public.stalls s on s.id = q.stall_id
where q.organization_id <> s.organization_id;

select count(*)
from public.stall_memberships sm
join public.stalls s on s.id = sm.stall_id
where sm.organization_id <> s.organization_id
   or sm.profile_id <> sm.user_id;
```

每個既有 tenant 必須恰好對應一個同 UUID organization，且 owner 不可遺失：

```sql
select id, slug from public.organizations order by id;

select organization_id, profile_id, count(*)
from public.organization_memberships
where role = 'ORGANIZATION_OWNER' and is_active
group by organization_id, profile_id;
```

遷移前後必須比對：

```sql
select organization_id, count(*) as orders, sum(total) as gross_total
from public.orders
group by organization_id
order by organization_id;

select organization_id, count(*) as products
from public.products
group by organization_id
order by organization_id;
```

## RLS 與應用驗證

```bash
npm run db:reset
npm run db:test
npm run typecheck
npm test
npm run build
```

必須另外以不同 Supabase Auth 使用者驗證：owner 看得到自己的全部攤位、staff 只看到已指派攤位、finance 無寫入權限，以及跨組織 URL/RPC 查詢回傳 404 或空集合。

## 回復與復原

此 migration 包含資料表改名、enum 擴充與大量回填，不提供會刪除新資料的自動 down migration。發生問題時依下列順序處理：

1. 立即停止寫入並切回維護模式。
2. 若 migration 尚未提交，由 PostgreSQL transaction 自動回復。
3. 若 migration 已提交但尚無新營運資料，從上線前 PITR/完整備份還原整個資料庫，再部署前一版應用。
4. 若已產生新資料，不可直接還原覆蓋；先建立事故副本，匯出受影響時間窗資料，再由資料庫管理者制定 forward-fix migration。
5. 回復後重新核對 orders、payments、QR token 與 membership，並保留事故 audit/log 證據。

## 相容期限制

- `tenants` 與 `user_accounts` 僅為受限 compatibility view，不是新功能的寫入介面。
- 舊 Edge RPC 暫時可寫 `tenant_id`；同步 trigger 會填入 `organization_id` 並拒絕不一致資料。
- 等所有 Edge Function 與 production job 都改用新欄位後，才可用另一個獨立 migration 移除 compatibility view、舊欄位與 trigger。
- modifier 與 payment 明細在後續階段新增；本階段不臆造既有系統中不存在的資料。
