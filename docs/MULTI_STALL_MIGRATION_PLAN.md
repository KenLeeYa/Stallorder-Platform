# StallOrder 多攤位資料遷移計畫

本文件適用於從單一商戶/攤位假設遷移至 `Organization -> Stall`。正式環境只能透過版本化 migration 執行，不得手動改寫 scope 或歷史營運資料。

## 遷移內容

- `tenants` 成為 `organizations`，既有 UUID 保持不變。
- `user_accounts` 成為 `profiles`，新增可選唯一 `auth_user_id`。
- Owner 轉 `ORGANIZATION_OWNER`；manager 轉 `STALL_MANAGER`；staff/kitchen 保留攤位指派。
- 所有 operational records 回填 `organization_id` 與 `stall_id`。
- 商品改為 organization master + `stall_products` assignment。
- 新增 payment、daily summary、operational events/alerts、plans/subscriptions/invoices/usage/invitations。
- 相容期保留受限 compatibility view 與舊 scope 欄位，由 trigger 強制一致。

## 上線前備份

1. 凍結 schema change、批次匯入與人員/方案管理，記錄 app SHA、migration version 與 Supabase project ref。
2. 建立 PITR checkpoint；未開啟 PITR 時做完整 custom-format backup。
3. 另行匯出 organizations/tenants、stalls、profiles/users、memberships、catalog、orders/items、payments、QR、audit。
4. 保存每 tenant/stall row count、訂單總額、付款總額、最新訂單與 QR state 作 baseline。
5. 在同版本 staging 還原副本完成 migration、pgTAP、build、E2E 與人工 smoke test。

```bash
pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" \
  > stallorder-pre-multi-stall.dump
```

連線字串由 secret manager 注入，不得寫入 repository 或 log。

## Migration 順序

1. `20260713000100_base_schema.sql`
2. `20260713000200_order_abuse_controls.sql`
3. `20260713000300_order_realtime_index.sql`
4. `20260713000400_product_categories.sql`
5. `20260713000500_multi_stall_role_enums.sql`
6. `20260713000510_multi_stall_foundation.sql`
7. `20260713000520_shared_product_catalog.sql`
8. `20260713000530_shared_product_order_rpc.sql`
9. `20260713000540_daily_summaries_and_payments.sql`
10. `20260713000550_operational_realtime_and_alerts.sql`
11. `20260713000560_commercial_and_invitations.sql`

所有 migration 應依檔名一次套用。不要單獨在 production 跳過 catalog RPC、scope trigger 或 RLS migration。

## 分階段部署

1. 部署能讀新欄位並保留舊 RPC compatibility 的 app/Edge 版本。
2. 進入維護/低寫入時段，套用 migration。
3. 執行唯讀 validation、RLS inventory、owner/membership/row count 核對。
4. 部署只寫 `organization_id/profile_id` 與 shared catalog 的版本。
5. 逐項 smoke test：Google login、workspace、QR session、建單、staff confirm、pickup、cash checkout、summary、report、invitation、額外攤位。
6. 觀察一個營業尖峰的 5xx、authorization denied、summary lag、audit write、Realtime fallback 與 DB 資源。

## Scope 驗證

以下結果必須為 `0`：

```sql
select count(*) from public.stalls where organization_id <> tenant_id;

select count(*)
from public.orders o
join public.stalls s on s.id = o.stall_id
where o.organization_id <> s.organization_id;

select count(*)
from public.stall_products sp
join public.stalls s on s.id = sp.stall_id
join public.products p on p.id = sp.product_id
where sp.organization_id <> s.organization_id
   or sp.organization_id <> p.organization_id;

select count(*)
from public.qr_codes q
join public.stalls s on s.id = q.stall_id
where q.organization_id <> s.organization_id;

select count(*)
from public.stall_memberships sm
join public.stalls s on s.id = sm.stall_id
where sm.organization_id <> s.organization_id
   or sm.profile_id <> sm.user_id;

select count(*)
from public.order_items item
join public.orders o on o.id = item.order_id
where item.organization_id <> o.organization_id
   or item.stall_id <> o.stall_id;
```

## 商務與摘要驗證

```sql
select organization_id, count(*) as stalls
from public.stalls where is_active group by organization_id;

select organization_id, count(*) as orders, sum(total) as gross_total
from public.orders group by organization_id order by organization_id;

select organization_id, count(*) as products
from public.products group by organization_id order by organization_id;

select organization_id, business_date,
       sum(order_count) as orders, sum(net_sales) as net_sales
from public.daily_stall_summaries
group by organization_id, business_date
order by organization_id, business_date;

select s.organization_id, s.id, sub.status, p.code,
       p.included_stalls, p.max_stalls
from public.stalls s
join public.subscriptions sub on sub.organization_id = s.organization_id
join public.plans p on p.id = sub.plan_id;
```

每個舊 tenant 必須保留同 UUID organization，且至少一名有效 owner。遷移前後比對 orders、payments、QR token/state、產品 assignment、membership 與報表總額。

## RLS 與應用驗證

```powershell
npm run db:reset
npm run db:test
npx supabase db lint --local
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

Production 另以不同真實 Supabase Auth 使用者驗證 owner 自有/跨組織、Finance read-only、Staff 未指派、Kitchen 財務拒絕與 client scope 竄改。

## 回復與復原

Schema rename、enum 與大量 backfill 不提供會刪除新資料的自動 down migration：

1. Migration transaction 未提交時停止並由 PostgreSQL rollback。
2. 已提交但尚無新寫入時，停止應用、從 PITR/完整備份還原，再部署前一版。
3. 已有新訂單時，立即停止寫入並建立事故副本；匯出受影響時間窗，以 forward-fix migration 修復。
4. 不得直接還原覆蓋新訂單、付款或邀請接受資料。
5. 回復後重新核對 membership、orders/payments、QR、summaries、subscription/invoice/usage 與 audit evidence。

## 已知分階段限制

- `tenants/user_accounts` compatibility view 與舊欄位待所有 production job 切換後，才以獨立 migration 移除。
- 現有資料庫沒有 modifier tables；modifier master/assignment/snapshot 必須另案設計與遷移。
- Plan base fee、included/excess order 價格沒有產品決策資料，目前為 0/NULL；正式收費前必須受控更新。
- 外部 Google 同意頁無法在無憑證 CI 執行，需 staging/production 手動驗收。
