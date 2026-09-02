# Invoice State Machine

```text
PENDING -> ISSUING -> ISSUED
                   `-> ISSUE_FAILED

ISSUED -> VOID_PENDING -> VOIDED | VOID_FAILED
ISSUED/PARTIALLY_ALLOWED -> ALLOWANCE_PENDING
                          -> PARTIALLY_ALLOWED | FULLY_ALLOWED | ALLOWANCE_FAILED
PARTIALLY_ALLOWED/FULLY_ALLOWED -> ALLOWANCE_VOID_PENDING
                                 -> ALLOWANCE_VOIDED | ALLOWANCE_VOID_FAILED

任何 remote/local 差異 -> RECONCILIATION_REQUIRED -> MANUAL_REVIEW
```

所有 transition 先經 allowlist 驗證。禁止例如 `PENDING -> VOIDED` 的跳躍，也禁止以重試直接跳過 pending 狀態。

Provider operation 狀態為：`PENDING`、`PROCESSING`、`SUCCEEDED`、`FAILED`、`RETRY_SCHEDULED`、`DEAD_LETTERED`。文件狀態與 operation 狀態分開保存。
