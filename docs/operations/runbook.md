# 系統強化操作 Runbook

## 日常檢查

1. 查看系統強化模組與整合設定中心，確認狀態沒有被誤標。
2. 檢查 audit、operational alerts、outbox backlog、Webhook failures 與 migration history。
3. 檢查 KPI 最後彙整時間，不用過期摘要做營運決策。

## 模組異常

1. 記錄 organization、module flag、request id、開始時間與影響範圍。
2. 關閉單一 organization 的模組 flag；不要先刪資料。
3. 保留 audit、outbox、publication、ledger 與 delivery receipt。
4. 核對核心訂單、KDS、取餐與付款是否未受影響。
5. 修正後在本機／Staging 重現並完成 regression，再逐組織恢復。

## 禁止事項

- 不直接修改 immutable ledger、publication 或 attribution evidence。
- 不在 log、ticket 或聊天貼 secret、raw token、完整顧客資料。
- Gate=FAIL 時不發布、不繞過測試、不擴大 Feature flag。
