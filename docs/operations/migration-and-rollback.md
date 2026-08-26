# Migration 與 Rollback Runbook

## Apply 前

- 使用乾淨 commit/tree，確認 migration 順序與 SHA-256。
- 產生 additive-only Plan，核對 remote history 無 divergence/remote-only。
- 驗證新表 RLS、grants、trigger、FK scope 與估計 lock 時間。
- 先 Apply DR/Staging；完成 schema、API、smoke 與 DR readiness。

## Apply 後

- 核對 migration history、表數、FORCE RLS、authenticated grants=0。
- 保持新模組 flags OFF，再逐 organization canary。
- 監控 DB error、latency、outbox backlog、order/KDS/payment smoke。

## Rollback

本批 migration 為新增式；首選 operational rollback：

1. 關閉對應 Feature flag。
2. 停止 worker/Provider writes。
3. 保留表與 evidence，回復上一版 application。
4. 只有經獨立核准、備份與相依分析後才做 schema drop/data reversal。

本文件不是 Production 操作授權；Plan 與 Apply 必須各自取得明確核准。
