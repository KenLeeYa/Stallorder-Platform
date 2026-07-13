# 多攤位 RLS 與權限

## 安全模型

授權分三層，任一層都不能被 client role 或 URL 取代：

1. Supabase Auth/應用 session 識別 profile。
2. Next.js/Edge 驗證 RBAC、CSRF、rate limit 與物件 scope。
3. PostgreSQL RLS、foreign key、scope trigger 及交易條件保護資料。

`anon` 無業務表直接寫入權限。authenticated 的資料庫政策以 read 為主；所有應用寫入都經可信後端，避免前端繞過驗證與稽核。

## Helper functions

| Function | 含義 |
| --- | --- |
| `current_profile_id()` | 由 `auth.uid()` 安全解析啟用 profile |
| `is_organization_member(org)` | 是否為有效組織成員 |
| `has_organization_role(org, roles[])` | 是否具指定有效組織角色 |
| `can_access_stall(stall)` | 平台 admin、全攤組織角色或有效 stall membership |
| `has_stall_role(stall, roles[])` | 是否具指定有效攤位角色 |
| `can_view_stall_financials(stall)` | owner/admin/finance 或 stall manager 的財務 read 判斷 |

需要 `SECURITY DEFINER` 的 helper 固定 `search_path=''`、完整限定 schema，並撤銷 `public/anon` 不必要 execute。重建摘要與刷新警示只授權 service role。

## 角色矩陣

| 能力 | Owner | Org Admin | Finance | Stall Manager | Staff | Kitchen |
| --- | --- | --- | --- | --- | --- | --- |
| 全組織攤位 | 是 | 依 `all_stalls` | 是，只讀財務 | 否 | 否 | 否 |
| 管理組織/訂閱 | 是 | 否 | 否 | 否 | 否 | 否 |
| 共用商品主檔 | 是 | 是 | 否 | 否 | 否 | 否 |
| 攤位商品/售罄 | 是 | 授權攤位 | 否 | 指派攤位 | 否 | 否 |
| 訂單更新/結帳 | 是 | 授權攤位 | 否 | 指派攤位 | 指派攤位 | 僅 PREPARING/READY |
| 組織財務報表 | 是 | 授權範圍 | 是 | 指派攤位 | 否 | 否 |
| 人員管理 | 是 | 授權範圍 | 否 | 指派攤位 | 否 | 否 |

Kitchen 的訂單 policy 仍會排除未確認訂單，且 payment/summary policy 不包含 Kitchen。Finance 只有 `VIEW_REPORTS`，API mutation 在到達物件查詢前即回 403。

## Policy 範圍

- Organization table：有效組織 membership 或 platform admin。
- Stall table：`can_access_stall(id)`。
- Membership：本人或具人員管理範圍的組織/攤位管理者。
- Catalog master：同組織且至少一個授權攤位；assignment 再檢查 stall。
- Orders/items/events：同時比對 record organization 與授權 stall。
- Payments/summaries：`can_view_stall_financials`。
- Operational events：可存取 stall；付款事件再要求財務/結帳角色。
- Alerts：組織財務角色或 stall manager/staff；不開放 Kitchen。
- Subscription/invoice/usage：owner、finance 與 platform admin 的 read 範圍。
- Invitation：具 `MANAGE_STAFF` 的授權範圍。

## API 物件防護

- API 從 session profile 建立 authorized stall set，再比對 URL/body 中的 ID。
- 未授權 organization/stall/object 回 404，避免資源列舉；角色不允許的已知操作回 403。
- Client 傳入其他 `organization_id` 會被 strict Zod schema 拒絕或被伺服器覆寫。
- Batch action 先驗證所有 stall ID、明確確認字串與操作者權限，並回傳結果摘要。
- 最後一名有效 owner 以 transaction lock 保護，不能被停用或降級。

## 驗證

```powershell
npm run db:reset
npm run db:test
npx supabase db lint --local
npm run test:e2e
```

pgTAP 覆蓋 owner 自有/跨組織、admin、finance read-only、staff 多攤/未指派、Kitchen 財務拒絕、client stall ID 竄改、跨組織 order 及跨攤 update。Playwright 另以真實 session/API 驗證 Finance、Kitchen 與跨組織 URL 拒絕。

新增任何 public table 時，migration 必須同時完成：

1. `ENABLE` 與 `FORCE ROW LEVEL SECURITY`。
2. revoke 預設權限並只授必要 grant。
3. policy、scope constraint/trigger 與索引。
4. 跨 tenant、跨 stall、read/write 正反向 pgTAP。
5. 更新全表 RLS inventory 測試預期數量。
