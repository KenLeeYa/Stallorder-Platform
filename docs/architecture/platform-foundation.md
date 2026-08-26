# 平台共用基礎

## 共用契約

- Feature flag：`src/server/resilience/feature-flag-service.ts`。
- 模組目錄：`src/server/competitive-enhancements/module-catalog.ts`。
- Organization/Stall 授權：沿用既有 workspace、RBAC 與 API authorization。
- 事件可靠性：沿用 `domain_outbox`、`domain_inbox` 與 idempotency。
- 稽核：所有 merchant mutation route 寫入 audit event。

## 設計規則

1. 先驗證既有能力，再擴充；不得建立平行的訂單或權限核心。
2. 外部能力未驗證時預設關閉。
3. Secret 不進 client、log 或一般資料欄位。
4. 每個新資料表同時交付 scope、RLS、grant 與 backend guard。
