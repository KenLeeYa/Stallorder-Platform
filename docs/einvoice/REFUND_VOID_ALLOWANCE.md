# Refund、Void 與 Allowance

退款、付款、發票是三個獨立 domain；退款事件不直接保證發票已調整。

| 條件 | 建議動作 |
|---|---|
| 全額退款、發票仍可作廢、policy 允許 | VOID |
| 部分退款、Provider 支援折讓、policy 允許 | ALLOWANCE，金額不得超過尚未折讓餘額 |
| 能力不足、狀態不合或 policy 未允許 | MANUAL_REVIEW |
| Provider 成功但本地 timeout／未知 | RECONCILIATION_REQUIRED，不可盲目重送 |

作廢折讓必須引用既有 allowance reference。任何 Provider 4xx 不自動 retry；timeout/5xx 只記錄可 retry 分類，背景 worker 完成前由人工以新 idempotency key 重試。
