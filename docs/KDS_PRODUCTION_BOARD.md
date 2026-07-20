# KDS 廚房生產看板

## 範圍

Phase 1 提供行動裝置與平板可操作的廚房生產看板，保留既有點餐、付款、取餐碼與多租戶流程。

| 介面 | 用途 |
| --- | --- |
| /kitchen | 訂單、品項與工作站三種生產檢視 |
| /kitchen/stations | 工作站與商品／分類指派 |
| /kitchen/settings | 每攤位等候警示門檻 |

KDS API 位於 /api/stalls/[stallSlug]/kitchen/*，只接受已登入且具攤位權限的使用者。所有寫入都由可信任的伺服器端路由執行，不開放瀏覽器直接寫入資料表。

## 訂單狀態相容策略

現有系統已使用 WAITING_CONFIRMATION，因此不重新命名為 PENDING_CONFIRMATION，避免破壞既有 QR、報表、Realtime 與歷史資料。Phase 1 只新增 PACKING，目前允許的生產流程為：

    WAITING_CONFIRMATION -> CONFIRMED -> PREPARING -> PACKING -> READY -> COMPLETED

既有合法捷徑仍保留，例如 CONFIRMED -> READY。所有狀態轉換由後端白名單驗證，並寫入 order_events 與稽核紀錄。訂單取消時只取消尚未完成的生產工作，已完成工作保留為歷史證據。

## 資料模型

新增資料表：

- kitchen_stations
- kitchen_station_assignments
- order_production_tasks

每張表都有 organization_id、stall_id、created_at、updated_at。RLS 同時驗證組織成員、攤位成員、角色及有效狀態；authenticated 角色沒有生產工作資料表的直接寫入權限。

確認訂單後，資料庫 trigger 依「商品指定優先、分類指定其次、預設工作站最後」建立生產工作。工作建立與訂單狀態變更在 PostgreSQL 先完成，Realtime 僅作為重新抓取通知。

## 權限

| 角色 | 看板 | 更新工作 | 管理工作站／設定 | 訂單取消 | 財務欄位 |
| --- | --- | --- | --- | --- | --- |
| ORGANIZATION_OWNER | 是 | 是 | 是 | 是 | 依原權限 |
| ORGANIZATION_ADMIN | 是 | 是 | 是 | 是 | 依原權限 |
| STALL_MANAGER | 是 | 是 | 是 | 是 | 依原權限 |
| STAFF | 否 | 否 | 否 | 否 | 依原權限 |
| KITCHEN | 是 | 是 | 否 | 否 | 否 |
| FINANCE_VIEWER | 否 | 否 | 否 | 否 | 僅原財務介面 |

KDS 對 KITCHEN 回傳的訂單投影不含電話、外送地址、付款資訊、小計、折扣或總額。KITCHEN 不具一般訂單、列印、桌位或結帳 API 權限；資料庫以 can_view_kds 和 can_view_orders 兩個獨立 RLS 邊界隔離。權限同時由頁面、API 與 RLS 執行，前端隱藏不是授權邊界。

## 即時更新與可靠性

1. 寫入 PostgreSQL。
2. 發出 order_events 通知。
3. KDS 收到通知後重新取得權威資料。
4. 連線中斷時每 12 秒輪詢。
5. 介面顯示連線狀態並提供手動重新整理。

看板預設在 5 分鐘顯示警示、10 分鐘顯示嚴重逾時；門檻可按攤位調整。背景警示會建立 KDS_ORDER_OVERDUE 或 STATION_BACKLOG 營運警示。

## 商用授權

功能代碼為 KDS。授權由後端 entitlement service 驗證，不只在前端判斷。Lite、Standard、Pro 目前均可使用基本 KDS；後續多工作站進階限制可在商用方案階段調整，不需改變資料隔離模型。

## 驗證

涵蓋：

- 訂單確認後建立工作
- 商品與分類工作站路由
- 取消訂單連動工作
- 跨攤位 RLS 隔離
- KITCHEN 財務欄位最小化
- 任意狀態轉換拒絕
- 品項彙總
- 等候警示
- Realtime 重新連線與輪詢降級
- 行動裝置操作與管理頁權限

主要測試檔：

- src/lib/kitchen-contract.test.ts
- supabase/tests/database/kds_production_board.test.sql
- e2e/kds-production-board.spec.ts

## 部署與回滾

依序套用三個 KDS migration，不修改已套用的歷史 migration。應先部署至 Staging，完成資料庫、單元、建置與 Playwright 驗證後才可評估 Production。

回滾應先停用 KDS entitlement 與入口，再回滾應用程式。資料表與歷史生產工作不可在緊急回滾時直接刪除；資料庫結構移除需另建經審核的 forward migration。
