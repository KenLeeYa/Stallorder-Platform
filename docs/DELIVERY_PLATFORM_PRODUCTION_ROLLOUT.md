# 外送平台正式發布

## P8：Disabled Deployment

本變更可先部署 Expand-only Schema 與停用狀態程式碼，但不得自動合併或啟用。正式部署後確認所有新 Flag 與 Entitlement 仍為 `false`。

## 後續比例

1. 0%：Schema/Code deployed，全部 Provider Disabled。
2. Canary：僅平台測試 Organization/Stall。
3. 1%：核准商家清單，不使用隨機未同意商家。
4. 5% / 25% / 50%：每階段至少完整營業週期，檢查錯誤、重播、對帳、KDS、延遲。
5. 100%：仍以每攤位 Connection 與 Entitlement 控制，不做全域無條件開啟。

## Release Gate

- CI、Unit、pgTAP、DB Lint、Build、Ephemeral Smoke 全通過。
- Primary/DR、Backup、Migration、Monitoring 與 Rollback 核准。
- Google/LINE/Apple 與 Delivery Provider 分別驗證，不共用 Credential。
- Uber/foodpanda Partner Approval 與正式 Callback 已驗證。

## 禁止

不得從 Feature Branch 直接 Push Production Migration、不得以 DR 測試、不得自動建立正式 Canary、不得把 Production Secret 放進 Preview。
