# StallOrder 商業計費架構稽核

## 稽核範圍

- 基準提交：`d62dd89f6760285f34ce41306263c16256459183`
- 分支：`feature/commercial-billing-phase1`
- 稽核日期：2026-07-19
- 目標：Phase 1 人工計費可營運；Phase 2/3 僅保留預設關閉的擴充點。

本文件是 P0 的架構基準。所有後續 schema 變更必須使用新 migration，不修改已套用 migration。

## 已存在且直接重用

| 能力 | 現況 | 主要位置 |
| --- | --- | --- |
| 方案 | `plans` 已保存代碼、基本價格、攤位與訂單額度 | `prisma/schema.prisma`、`supabase/migrations/20260713000560_commercial_and_invitations.sql` |
| 訂閱 | 每個 Organization 一筆 `subscriptions`，已有六種文字狀態 | 同上 |
| 額外攤位 | `additional_stall_approvals` 已有交易鎖、價格快照與稽核 | `src/app/api/admin/organizations/[organizationId]/additional-stalls/route.ts` |
| Invoice | `invoices`、`invoice_line_items` 已存在並具有組織 scope trigger | commercial migration、`src/lib/subscription-data.ts` |
| 用量事件 | `usage_events` 已收集攤位、人員、QR、CSV 與訂單建立事件 | commercial migration |
| 訂閱頁 | 商家可檢視方案、用量估算、Invoice 與額外攤位 | `src/app/merchant/subscription/page.tsx`、`src/components/subscription-overview.tsx` |
| RBAC | Organization Owner 可管理訂閱；Finance Viewer 僅有報表讀取；Platform Admin 可跨組織管理 | `src/lib/rbac.ts`、`src/lib/authorization.ts` |
| 稽核 | `audit_logs` 支援 actor、request id、before/after JSON | `src/lib/audit.ts` |
| RLS | 現有商業表皆啟用及強制 RLS，匿名無權限 | commercial migration、database tests |
| 組織隔離 | 商業表寫入時以 trigger 驗證 Organization 關聯 | `enforce_commercial_scope()` |
| 排程 | 訂單逾時、報表寄送已有 pg_cron／Vercel Cron 配置 | `supabase/migrations/**cron**`、`vercel.json` |

## 關鍵差距

### P1 資料模型

1. `plans` 是可變資料，訂閱沒有不可變的 `plan_version_id` 合約快照。
2. 沒有 `plan_entitlements`，目前只能由方案欄位與 UI 推論功能。
3. 沒有 Add-on catalog、subscription items 或人工付款紀錄。
4. Invoice 缺少 discount、tax、amount paid、amount due、due/void 時間；狀態仍包含舊的 `ISSUED`。
5. Invoice 編號由應用程式亂數產生，未使用資料庫 sequence。
6. 用量以 `ORDER_CREATED` 為訂單指標，不符合完成後才計費的規則。
7. 沒有 period summary、billing notifications 或 notification outbox。
8. 沒有 server-only 商業 Feature Flag 儲存層。

### P2 權益與限制

1. `src/lib/billing.ts` 只處理攤位數量，沒有中央 Entitlement Engine。
2. 建立產品、員工、QR、CSV 與進階功能尚未統一由權益服務驗證。
3. Trial 到期／100 筆完成訂單硬限制尚未接到公開 order session 與 order RPC。
4. 付費方案額度警告與手動 order package 尚未實作。
5. `SUSPENDED` 目前會使一般 workspace 消失，尚未保留帳務與歷史資料入口。

### P3 營運流程

1. 缺少 Merchant Billing、Invoice detail、Usage、Plans 頁面。
2. 缺少 Platform Admin Billing queue、Invoice、Payment、Subscription 操作頁。
3. 缺少「付款送審 -> 驗證 -> Invoice PAID -> Subscription ACTIVE」單一交易流程。
4. 缺少人工續約、停權、復權、付款拒絕及用量重建工作流。
5. 缺少帳務通知與所有敏感狀態轉換的完整稽核事件。

## 角色矩陣

| 操作 | Platform Admin | Organization Owner | Finance Viewer | Organization Admin | Stall Manager / Staff / Kitchen | Anonymous |
| --- | --- | --- | --- | --- | --- | --- |
| 檢視方案與公開價格 | 允許 | 允許 | 允許 | 摘要 | 否 | 否 |
| 檢視自身訂閱／用量／Invoice | 全部組織 | 允許 | 允許 | 摘要 | 否 | 否 |
| 送出人工付款資料 | 代登錄 | 允許 | 允許 | 否 | 否 | 否 |
| 建立／開立／作廢 Invoice | 允許 | 否 | 否 | 否 | 否 | 否 |
| 驗證／拒絕付款 | 允許 | 否 | 否 | 否 | 否 | 否 |
| 啟用／續約／停權／復權 | 允許 | 否 | 否 | 否 | 否 | 否 |
| 核准攤位／Order package／Add-on | 允許 | 僅申請 | 否 | 否 | 否 | 否 |
| 重建用量摘要 | 允許 | 否 | 僅讀 | 否 | 否 | 否 |

所有寫入仍須通過伺服器 session、RBAC、CSRF、Zod、rate limit 與資料庫交易。前端隱藏按鈕不構成授權。

## 訂單與限制接點

| 操作 | 現有入口 | P2 接法 |
| --- | --- | --- |
| 建立攤位 | `/api/merchant/organizations/:id/stalls` | transaction lock + `max_stalls` |
| 建立員工 | stall membership／invitation routes | transaction lock + `max_staff` |
| 建立產品 | stall/catalog/import routes | transaction lock + `max_products` |
| 建立 QR | modules／ordering routes | transaction lock + `max_qr_codes` |
| CSV 匯出 | catalog/report export routes | `CSV_EXPORT` entitlement |
| Kitchen／進階報表／排程報表 | page/API authorization | feature entitlement |
| 建立公開 order session | `create-order-session` Edge Function + database RPC | subscription usable + trial quota |
| 建立公開訂單 | `create-public-order` Edge Function + database RPC | 交易內重查 subscription/quota |
| 完成訂單 | staff order update + table checkout | DB trigger 建立唯一 `BILLABLE_ORDER_COMPLETED` |

## 排程責任

- DB-only：trial expiration、Invoice overdue、usage threshold、period summary reconciliation 應由 pg_cron 呼叫冪等 SQL function。
- External：Email、外部金流與電子發票均保持關閉，因此 P0-P4 不新增外部排程。
- 不在 Vercel Cron 重複執行相同帳務狀態維護。

## 安全決策

- 新 `public` 表一律明確 `REVOKE`、`GRANT`、`ENABLE/FORCE RLS`，不依賴 Supabase 預設 exposure。
- 商家 Data API 只允許自身資料的必要讀取及 pending payment insert；敏感狀態寫入僅 service role／可信任伺服器。
- Invoice 金額、方案價格、付款驗證及訂閱狀態只由伺服器和資料庫計算。
- 不儲存完整銀行帳號、卡號、CVV、付款密碼或未受控付款截圖。
- 所有 future provider route 預設 fail closed，不接受瀏覽器 redirect 作為付款證明。

## P0 基準驗證

| 命令 | 結果 |
| --- | --- |
| `npm ci` | 通過，0 vulnerabilities |
| `npm run lint` | 通過 |
| `npm run typecheck` | 通過 |
| `npm test` | 35 files / 138 tests 通過 |
| `npm run build` | Next.js production build 通過 |

