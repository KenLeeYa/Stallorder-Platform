# 通路感知菜單

## 模型

- `catalog_menu_versions`：immutable version metadata 與生命週期。
- `catalog_version_items`：商品、價格、註記與套餐快照。
- `catalog_channel_overrides`：通路、攤位、區域、價格、顯示與供應覆寫。
- `catalog_publications`：發布目標、idempotency、checksum、重試與結果。

## 生命週期

`DRAFT → IN_REVIEW → APPROVED → PUBLISHED → SUPERSEDED`

內容只允許在草稿修改；發布是 server-authoritative。正式同步 Provider 前仍需 Adapter、Sandbox 與 publication receipt 驗證。

## 2026-10-02 共用商品操作情境

列內編輯商品保留原共用商品清單、搜尋與分頁，只開既有編輯對話框；儲存或取消後回到原查詢。原實作是 client state 將清單替換成完整管理畫面，並非 URL 路由跳轉；現在只有明確的「完整管理／新增商品」入口切換完整管理。商品已不存在時確認錯誤並返回刷新原清單。桌面／平板標題不換行，右方工具群靠右並可換行；手機搜尋獨立全列，狀態與排序並列。
