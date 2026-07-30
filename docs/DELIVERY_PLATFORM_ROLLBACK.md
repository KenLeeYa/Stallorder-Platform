# 外送平台回復與 Forward Fix

## 安全回復

1. 關閉 Provider Action、Import、Menu Sync 與 UI Flag。
2. 將受影響 Connection 改為 `PAUSED`。
3. 停止建立新 Job；保留 Webhook、External Order、Job 與 Audit Ledger。
4. 完成既有 Canonical Order 的現場處理，不刪除訂單。
5. 對 Payment 保持 `PENDING_RECONCILIATION`，由財務人工核對。

## 程式回復

回復 Vercel Deployment 不會回復資料庫。Migration 為 Expand-only，舊程式不使用新表/欄位。正式環境不得自動執行 Destructive Down Migration。

## Schema Forward Fix

- 新增修正 Migration，不修改已套用 Migration。
- 不刪除 `external_*` Ledger 或 Canonical Order 外鍵。
- 若未來移除欄位，必須先證明全部 Connection 關閉、Job 清空、Retention/法務核准並完成備份。

## Provider Action 風險

Accept/Reject 若回應不確定，先查 Provider 狀態，不可單純切換 Circuit 重送。只有穩定 Idempotency 契約與已確認未執行時才可重試。

## Preview 清理

PR 關閉後刪除 Vercel Deployment 與 data-less Supabase Branch。清理失敗時以 `stallorderPreviewResource=pr-<number>` Metadata 找出並人工刪除，不可刪除 Production Project。
