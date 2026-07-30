# 災難復原總則

日期：2026-07-29

## 現況聲明

StallOrder 的正常架構是單一 Production Primary writer，加上一個未來可提升的
非同步 `READ_ONLY_STANDBY`。這不是 Active-Active，也不允許雙 writer。

目前已完成：

- 隔離環境單向 logical replication capability proof。
- backend identity、fencing、promotion epoch 與 DR write rejection。
- readiness、freeze、promotion、validation 與 failback 的 dry-run／apply 腳本。
- Database、Auth、Storage、Edge、QR、離線 POS 與付款的連續性設計。

目前尚未完成：

- 尚未把任何現有 Supabase 專案核准轉換為 Production DR。
- 尚未建立持續 Production replication。
- 尚未在真實 DR 執行 promotion／failback。
- 因此沒有可宣告的 Production DR 實測 RTO／RPO。

不得把腳本 dry-run 或 capability proof 延遲當成 Production RTO／RPO。

## 目標

| 模式 | 目標 RPO | 目標 RTO | 生效條件 |
| --- | --- | --- | --- |
| Logical replication DR | 不超過 5 分鐘 | 不超過 30 分鐘 | 真實 DR、穩定 lag、兩次完整演練通過 |
| Warm-backup fallback | 不超過 24 小時 | 不超過 4 小時 | 加密備份與完整 restore 已演練 |
| Offline Leader | 本機已提交 IndexedDB 交易為 0 | 現場立即持續 | Permit、snapshot、quota 與裝置核准有效 |

這些是驗收目標，不是目前 SLA。

## 啟動條件

只有事故指揮可啟動 DR 評估。常見條件：

- Primary 長時間無法連線或已確認專案層級故障。
- Primary 資料損壞且 forward-fix 不安全。
- 已確認主要區域故障，且候選 DR 位於可用區域。

單一 Edge Function、Realtime、SSE、Vercel deployment 或付款供應商故障不應
直接提升 DR；先使用既有 circuit、polling、rollback 或付款備援。

## 決策順序

1. 宣告事件、停止不必要變更並保存時間線。
2. 透過 QR 降級旗標或 backend fence 阻止不安全的新線上寫入。
3. 確認離線 POS 可用範圍與待同步 queue。
4. 只讀執行 DR readiness，確認 migration、RLS、lag、Storage、Auth、Edge、
   sequence 與付款 callback。
5. 凍結 Primary。
6. 重新確認 Primary 已 sealed、DR readiness 仍全綠。
7. 經 requester／approver 雙人核准後提升 DR 並增加 promotion epoch。
8. 切換受保護 runtime bindings，部署已驗證的同一 commit。
9. 驗證 QR、Staff、KDS、現金、離線同步與 false-success／duplicate 指標。

詳細命令見 [PRODUCTION_FAILOVER_RUNBOOK.md](PRODUCTION_FAILOVER_RUNBOOK.md)。

## Failback

DR 成為 writer 後，舊 Primary 不再是可直接 rollback 的 deployment：

1. 保持 DR 為唯一 writer。
2. 備份兩端並將 DR-era writes 單向補回 Primary。
3. 核對訂單、付款、用量、audit、Inbox／Outbox、offline receipt、Auth 與
   Storage。
4. 推進 Primary sequence。
5. 短暫 seal DR。
6. 經雙人核准提升 Primary，並增加 promotion epoch。
7. 將 DR 降回 `READ_ONLY_STANDBY`，重建 Primary -> DR 單向 replication。

詳細命令見 [PRODUCTION_FAILBACK_RUNBOOK.md](PRODUCTION_FAILBACK_RUNBOOK.md)。

## 本機演練

以下只驗證腳本契約，不連線、不寫資料：

```powershell
npm run resilience:game-day -- --verify-dry-runs
```

任何實際 `--apply` 都必須由各 runbook 的受保護環境、明確 confirmation、
requester、approver 與事故原因執行。本總覽腳本故意不支援 `--apply`。

## 復原完成條件

- 只有一個 `ACTIVE_WRITER`，另一端拒絕正常應用寫入。
- Availability target 與 promotion epoch 和資料庫一致。
- 新舊 epoch 離線 queue 無 canonical duplicate。
- 訂單 false success 為零。
- 付款差異、Storage checksum、Auth identity 與 migration drift 已處理。
- RLS、RBAC、CSRF、Turnstile、rate limit、idempotency 與 audit 回歸通過。
- 事故指揮、資料負責人與營運負責人共同核准。
