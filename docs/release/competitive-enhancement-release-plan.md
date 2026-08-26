# 系統強化發布計畫

## 本次界線

使用者已在本次發布回合授權 GitHub、DR 與 Production 的 fresh Plan／Apply；授權不放寬 Gate=FAIL 停止條件，也不啟用 Provider write、顧客發送、Webhook egress 或活動 attribution capture。

## 未來發布順序

1. 合併前 code/security review，確認原使用者工作區未被覆寫。
2. 全量 Gate：install、lint、typecheck、tests、build、UI audit、npm audit、migration checks。
3. Merge Staging；以 immutable commit/tree 建立 Staging/DR Plan。
4. Apply 後驗證 schema、RLS、API、核心訂單、KDS、取餐、付款與 DR lag/readiness。
5. 建立綁定同一通過來源的 Production Plan，依本次授權自動核准 Apply。
6. Production application/migration 採安全拆分；所有新模組仍預設 OFF。
7. 只對內部測試組織 canary，依序 CORE → HQ → Supply → Growth design → Event design → API read → Analytics。
8. Provider、Webhook delivery、顧客發送與活動 capture 需獨立 Gate，不隨 application 自動開啟。

## Rollback 判準

跨租戶、訂單重複、付款／庫存不一致、錯誤率或延遲超標、DR 不就緒時立即停止 rollout，關 flag 並回復上一 application artifact。
