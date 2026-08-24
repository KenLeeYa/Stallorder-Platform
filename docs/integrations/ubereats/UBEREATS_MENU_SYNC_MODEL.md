# Uber Eats Menu Sync Model

目前唯一已實作的 menu mutation 是單品 sparse suspension：

`POST /v2/eats/stores/{store_id}/menus/items/{item_id}`

Store 與 item ID 必須來自 connection/mapping，不能由前端任意指定。`available=false` 送出有限的 suspension payload；`available=true` 清除 suspension。

Menu read、full menu upload、refresh webhook 與 source-of-truth ownership 尚未完成。`UBER_EATS_MENU_READ_ENABLED` 與 `UBER_EATS_MENU_FULL_WRITE_ENABLED` 必須 OFF；只有取得 Uber 核准、完成 mapping/E2E 且明確確定 StallOrder 為 source of truth 後，才可評估啟用 item write。
