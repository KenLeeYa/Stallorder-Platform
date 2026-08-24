# StallOrder PAYG 計費模型

## 合約

- 月基本費：TWD 0。
- 買斷費：TWD 0。
- 最低消費：TWD 0。
- 每筆淨計費完成訂單：TWD 1。
- 每個攤位、每個計費月最高：TWD 1,499。
- 多攤位各自封頂後加總，不套用 Organization 共用上限。
- Enterprise 保留人工報價；LITE、STANDARD、PRO 保留既有合約與歷史帳單，但不再提供新申購。

```text
stall_net_orders = max(completed_orders - full_refund_credits, 0)
stall_uncapped = stall_net_orders * TWD 1
stall_charge = min(stall_uncapped, TWD 1,499)
organization_charge = sum(stall_charge)
```

所有 TWD 金額均為 integer。瀏覽器輸入的價格、數量、攤位、退款或封頂值都不是計費真相。

## 計費事件

- 訂單第一次進入 `COMPLETED` 且 `is_test=false` 時寫入唯一 `BILLABLE_ORDER_COMPLETED`，數量為 `1`。
- 完整退款第一次成立時寫入唯一 `BILLABLE_ORDER_FULL_REFUND`，數量為 `-1`。
- 重複完成、重複退款 callback 與 idempotent replay 不增加事件。
- 部分退款維持付款帳務行為，不自動產生完整 TWD 1 折抵。
- 取消、拒絕、逾時、測試單與安全驗證失敗不計費。
- 原始 `usage_events` append-only；不得為修正 summary 而刪除或改寫事件。

`billing_stall_usage_summaries` 是可重建的每攤位快照，ledger 才是來源。每筆摘要保存完成訂單、完整退款、淨計費訂單、未封頂金額、封頂金額、最終費用與封頂節省。

## 帳期與 Invoice

- 對商家顯示的月界線使用 `Asia/Taipei`，資料庫時間戳維持既有 UTC 慣例。
- PAYG Invoice 在可信 server transaction 中先重建指定月份，再為每個攤位建立一條 `PAYG_USAGE` line。
- Line quantity 固定為 `1`，line amount 是已封頂的可信最終費用；計算明細保存在 immutable metadata。
- Invoice 保存 `plan_version_id`、`pricing_mode` 與 `pricing_snapshot_json`，日後調整目錄不會改寫舊帳單。
- 同一 Organization 與 billing period 重複關帳必須 idempotent；若既有帳單快照或金額衝突則 fail closed。

## Trial 與遷移

正常商業流程是 `TRIAL → PAYG → ENTERPRISE（選用／人工）`。關閉開放測試後，Trial 維持 14 天或 100 筆完成訂單任一先到即停止新的公開點餐。

既有 LITE、STANDARD、PRO 不會自動遷移。Platform Admin 必須：

1. 啟用對應 rollout flags。
2. 選擇下一個計費月邊界的明確生效日。
3. 輸入原因並勾選確認。
4. 由 server transaction 寫入 before/after、actor、request ID 與 `SUBSCRIPTION_MIGRATED_TO_PAYG` audit。

不支援靜默回溯調價或在月中自行建立 proration。第一個 PAYG 月只計入 `pricing_effective_at` 之後的可信事件。

## 開放測試發布狀態

目前 migration 的保守預設：

| Flag | 預設 | 效果 |
| --- | --- | --- |
| `OPEN_BETA_FREE_ACCESS_ENABLED` | true | 免除 Trial 到期、方案功能與數量限制；仍記錄用量，不得自動關帳 |
| `MERCHANT_BILLING_VISIBLE` | false | 隱藏商家帳務導覽、頁面、mutation API 與直接網址 |
| `PAYG_BILLING_ENABLED` | false | 禁止 PAYG 遷移與關帳主流程 |
| `PAYG_NEW_MERCHANTS_ENABLED` | false | 禁止 Trial 遷移 PAYG |
| `PAYG_LEGACY_MIGRATION_ENABLED` | false | 禁止 legacy 遷移 PAYG |
| `PAYG_REFUND_CREDITS_ENABLED` | false | 禁止以 PAYG 正式關帳 |
| `PAYG_AUTOMATIC_INVOICE_CLOSE_ENABLED` | false | 禁止自動關帳 |

開放測試不是安全繞過：Organization 仍須有 Subscription；`SUSPENDED`、`CANCELLED` 與無 Subscription 都維持 fail closed。平台可在不向商家顯示付款功能的情況下先完成設定與 QA。

建議正式啟用順序：先驗證 schema／ledger／rebuild，再啟用 `PAYG_BILLING_ENABLED` 與 refund credits；確認新商家流程後才啟用新商家遷移；確認商家文案與客服流程後才啟用 `MERCHANT_BILLING_VISIBLE`；自動關帳最後獨立啟用。切換均由 Platform Admin 介面確認並寫入 audit。

## 金流與外部費用

StallOrder 的 TWD 1 是平台用量費，不包含信用卡 MDR、LINE Pay、ECPay、NewebPay、外送、電子發票、訊息或外部加購費。商家顧客款項維持商家直收；本變更不建立代收代付或資金保管架構。

## 對帳、回復與 Gate

對帳以相同 immutable revision 進行：

1. 比對每攤位完成與完整退款事件的唯一性。
2. 重建 `billing_stall_usage_summaries`。
3. 驗證 `net = max(gross - refund, 0)`、`final = min(net, 1499)`。
4. 比對 Invoice line metadata、總額與每攤位 summary。
5. 記錄 actor、request ID 與差異原因；不修改原始訂單、付款或 usage event。

若上線 Gate 失敗：先關閉商家顯示與全部 PAYG rollout flags；不要修改 applied migration，不要刪除 ledger／summary／invoice。Schema 問題以核准的新 forward migration 修正，資料回復使用既有備份／PITR 流程。

## Production gap hardening（2026-08-24 本機來源）

計費契約現在明確包含時區、月界線、稅務、cap tax basis、捨入、稅務文件、關帳延遲、封存者與 contract hash；Subscription 與 Invoice 保存不可變 snapshot。既有 PAYG v1 不會被自動封存或賦予稅率，仍須由核准的新版本才能進入正式收費。

詳細操作與狀態見 [PAYG_PRODUCTION_GAP_BASELINE.md](PAYG_PRODUCTION_GAP_BASELINE.md)、[PAYG_TAX_POLICY.md](PAYG_TAX_POLICY.md)、[PAYG_AUTOMATIC_CLOSE.md](PAYG_AUTOMATIC_CLOSE.md) 與 [PAYG_PRODUCTION_READINESS.md](PAYG_PRODUCTION_READINESS.md)。
