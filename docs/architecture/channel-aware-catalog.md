# 通路感知菜單

## 模型

- `catalog_menu_versions`：immutable version metadata 與生命週期。
- `catalog_version_items`：商品、價格、註記與套餐快照。
- `catalog_channel_overrides`：通路、攤位、區域、價格、顯示與供應覆寫。
- `catalog_publications`：發布目標、idempotency、checksum、重試與結果。

## 生命週期

`DRAFT → IN_REVIEW → APPROVED → PUBLISHED → SUPERSEDED`

內容只允許在草稿修改；發布是 server-authoritative。正式同步 Provider 前仍需 Adapter、Sandbox 與 publication receipt 驗證。
