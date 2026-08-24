# foodpanda Migration Plan

1. 在 ephemeral DB 執行所有 migrations 與 Prisma validation。
2. 套用 `20260821100000_delivery_provider_contracts.sql`：把 order/event/job unique key 改為 connection-scoped，加入 `ORDER_FETCH` 與 provider flags。
3. 驗證舊資料不會造成新 unique constraint 衝突；若有衝突，停止 migration，不自動刪除或合併資料。
4. 先部署程式與 schema，所有 flags 保持 OFF。
5. Sandbox 與 pilot 通過後才逐項啟用。

這是 constraint replacement，Production Apply 前需備份、dry-run、鎖定 migration revision 與核准維護窗口；本次沒有執行遠端 DB migration。
