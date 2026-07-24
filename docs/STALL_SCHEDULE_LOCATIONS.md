# 出攤地點與市集行程

## 範圍

Phase 5 提供移動攤販所需的常用地點、市集活動、出攤行程、公開行程頁與 QR 行程綁定。排程可以自動開放或停止公開點餐，但不會取消已確認訂單。

## 介面

| 路徑 | 用途 |
| --- | --- |
| `/merchant/stalls/[stallId]/locations` | 建立、修改、停用與刪除常用出攤地點 |
| `/merchant/stalls/[stallId]/schedule` | 建立行程、複製週期、臨時停業、延遲開攤、提前收攤及 QR 綁定 |
| `/merchant/events` | 組織層級市集活動管理，僅具對應方案與組織管理權限者可用 |
| `/s/[stallSlug]/schedule` | 顧客公開行程、目前地點、下一次出攤及地圖導航 |

公開 API 為 `/api/public/stalls/[stallSlug]/schedule`，只回傳顧客所需欄位，不包含資料庫 ID、組織 ID、內部備註或營運設定。

## 資料與隔離

- `stall_locations` 綁定 `organization_id` 與 `stall_id`。
- `market_events` 是組織共用活動，不能跨組織搬移。
- `stall_schedules` 必須綁定同攤位地點或同組織活動。
- QR、order session 與 order 儲存可信任的地點、活動及行程快照關聯。
- 所有新表啟用並強制 RLS；匿名角色不能直接讀寫內部表，authenticated 不能繞過 API 寫入。
- API 從登入會員與攤位成員關係推導組織／攤位範圍，不接受前端提供可信任 scope。

## 排程自動化

`app_private.process_stall_schedules()` 每分鐘由 `pg_cron` 執行：

1. 到達開放時間後，以可重入方式將 `SCHEDULED` 改為 `OPEN`。
2. 攤位停用、售罄或容量控制為人工暫停時，不自動恢復接單。
3. 到達關閉時間後將行程改為 `COMPLETED`，停止新公開點餐並撤銷尚未使用的 order session。
4. 已成立或已確認訂單保持原狀，繼續由現場完成。
5. 每次自動開關、人工狀態調整與 QR 綁定均寫入 audit log。
6. `DELAYED` 行程建立 `SCHEDULE_START_DELAYED` 營運警示，狀態結束後自動解除。

## QR 驗證

建立 order session 與送出訂單時，後端均重新驗證：

- 地點仍啟用。
- 活動未過期。
- 行程屬於相同組織與攤位。
- 行程狀態為 `OPEN` 且在接單時間內。
- 點餐類型符合 QR 綁定的外帶、內用或外送情境。
- session 內的行程快照與 QR 現況相同。

修改 QR 綁定會撤銷既有 active session；前端查詢或 URL 參數不能覆寫可信任情境。

## 方案與權限

- `STALL_LOCATION` 控制地點數量與多地點能力。
- `STALL_SCHEDULE` 控制進行中行程數量、週期複製、自動開關與活動行程。
- Owner／Organization Admin 可管理授權範圍；Stall Manager 可管理指派攤位的地點與行程。
- Staff 只能讀取指派攤位必要資料；Kitchen、Finance Viewer 不能進入管理 API。

## 驗證

- Schema／合約與 RBAC：`src/lib/stall-schedule-contract.test.ts`、`src/lib/stall-schedules.test.ts`、`src/lib/rbac.test.ts`
- RLS、跨攤位、排程與 QR：`supabase/tests/database/stall_schedule_locations.test.sql`
- UI、公開資料最小化、時區與角色：`e2e/stall-schedule-locations.spec.ts`
