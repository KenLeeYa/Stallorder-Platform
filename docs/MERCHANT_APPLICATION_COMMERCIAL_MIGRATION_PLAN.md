# 商家申請與商用資料遷移計畫

## 原則

- 只新增 migration，不修改已套用 migration。
- 保留所有既有 Organization、membership、Subscription、Order、usage、Invoice 與付款資料。
- 舊版已建立商家的 Owner 不需重新申請。
- Production 套用前必須先在 Staging 執行申請、核准、測試訂單與 Go-live 驗收。

## Migration 順序

1. 建立商家申請 enum、application number sequence、`merchant_applications` 與 application notifications。
2. 建立 `merchant_setup_progress`。
3. 在 `orders` 新增 `is_test boolean not null default false`。
4. 啟用／強制新表 RLS，設定最小 grants 與 applicant／Platform Admin policies。
5. 更新 billable usage trigger，排除 `is_test=true`。
6. 更新日報重建函數與一般報表查詢，排除測試訂單。
7. 加入 stale draft／NEEDS_INFO 過期的 idempotent database job。

## Backfill

- 既有 orders：由欄位 default/backfill 設為 `is_test=false`。
- 既有 Organization：不建立虛構申請，不改 owner 或 subscription。
- 如需稽核鏈結，另行建立 `MIGRATED_LEGACY` 類型事件；不擴充本階段狀態機。

## 部署順序

1. 建立 Staging database backup／PITR 檢查點。
2. 套用新 migrations 並執行 pgTAP。
3. 部署 application code。
4. 使用新的 Google-linked 測試 profile 建立申請。
5. 驗證送出後 Organization／Stall／Subscription 數量不變。
6. Platform Admin 核准，驗證 QR=PAUSED、Stall=CLOSED。
7. 完成測試訂單，驗證 usage 與 financial summary 不變。
8. Organization Owner 明確 Go-live，驗證 QR=ACTIVE、Stall=OPEN。
9. 驗證既有 billing、invoice、manual payment、suspension 與 reactivation。
10. 完成觀察後才規劃 Production migration。

## 回復策略

### Code rollback

- 回復至部署前 Vercel deployment。
- 新資料表保留，不在緊急 rollback 中刪除申請或審核紀錄。

### Database rollback

- 若尚無正式申請資料，可用獨立 rollback migration 移除新 trigger／policy／table／enum。
- 若已有申請資料，只停用新入口並保留 schema，禁止 destructive rollback。
- `orders.is_test` 可安全保留；舊版程式會忽略額外欄位。
- 若新 summary function 有問題，使用 rollback migration 恢復前一版函數，並保留測試訂單識別供後續重建。

## Production 閘門

- 所有測試與 build 通過。
- Staging 驗收三項核心不變條件：申請不建商家、核准仍暫停 QR、測試完成後才可接單。
- 不存在跨申請、跨 Organization 或 internal note 暴露。
- 不存在測試訂單用量或營收污染。
- PR 經人工審查；本分支不得自動合併。
