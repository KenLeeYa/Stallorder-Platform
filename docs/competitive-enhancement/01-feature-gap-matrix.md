# 功能差距矩陣

狀態：`既有可用`、`本次可本機驗證`、`安全基礎`、`外部阻擋`。

| 模組 | 目標 | 現況 | 仍需完成 |
| --- | --- | --- | --- |
| CORE_OPS | QR/POS/KDS/取餐/報表 | 既有可用 | 持續回歸與效能量測 |
| HQ | 菜單版本、通路覆寫、審核發布 | 本次可本機驗證 | 大量商品壓測、正式 rollout |
| GROWTH | Customer 360、優惠、集點、推薦、RFM | 安全基礎＋優惠草稿可測 | 同意核准、發放與訊息 E2E |
| OMNI | LINE、品牌頁、外送、付款、發票 | 既有／本次整合狀態盤點 | Provider Sandbox 與正式認證 |
| SUPPLY_LITE | 食材、配方、庫存、耗損、成本 | 本次可本機驗證 | 訂單扣庫策略、ERP dry-run |
| EVENT_GROWTH | 活動 QR、來源歸因、費用、報表 | 活動與費用可測；歸因關閉 | 雙下單路徑同等整合測試 |
| PUBLIC_API | Scoped key、v1 API、Webhook | 唯讀菜單 API 與管理 UI 可測 | Egress、重送 worker、OpenAPI 產物 |
| ADVANCED_ANALYTICS | KPI 治理與跨模組健康度 | 本次可本機驗證 | 穩定資料量後再加規則式洞察 |

## 不建立的重複功能

- 不新增第二套訂單、KDS、付款、RBAC、Feature flag 或 Outbox。
- 不用估算填補缺少的顧客、結算或外部平台資料。
- 不把架構完成、Mock 成功或本機測試標示成 Production Ready。
