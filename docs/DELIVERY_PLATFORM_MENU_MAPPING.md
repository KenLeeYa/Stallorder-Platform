# 外送平台菜單對應

## 對應層級

`external_menu_mappings` 支援：

- `PRODUCT`
- `MODIFIER_GROUP`
- `MODIFIER_ITEM`

同一 Connection 下，Internal Entity 與 External Entity 均不可重複對應。

## 匯入驗證

建立 Canonical Order 前必須同時成立：

1. Connection 為 `ACTIVE`。
2. External Store Mapping 為 `VERIFIED`。
3. Currency 與 Stall 一致。
4. Product Mapping 存在，商品啟用且未售罄。
5. Modifier Mapping 存在，註記啟用且確實指派給該商品。
6. Provider Payload 通過 Strict Schema。

任一條件不成立時：

- 不建立部分 Order。
- `external_orders.processing_status = MAPPING_REQUIRED`。
- Webhook 進入可追蹤終止狀態。
- 建立去重營運警示。

## 商家操作

商家可在 `/merchant/integrations/delivery/:connectionId/menu-mapping` 檢視與更新對應。所有 Mutation 經 Session、CSRF、Permission、Stall Scope、Feature Flag 與 Entitlement 驗證。

正式 Menu Push 尚未啟用；需等 Provider Approval、Sandbox Diff 與回滾測試後才可開啟 `DELIVERY_MENU_SYNC_ENABLED`。
