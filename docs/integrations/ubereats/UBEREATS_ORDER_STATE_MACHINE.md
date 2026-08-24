# Uber Eats Order State Machine

```text
WEBHOOK_REFERENCE -> ORDER_FETCH -> RECEIVED -> IMPORTED
IMPORTED -> ACCEPT_QUEUED -> ACCEPTED
IMPORTED -> REJECT_QUEUED -> REJECTED
ACCEPTED -> PREPARING (local observation only)
provider cancel event -> CANCELLED
failure -> RETRY/DLQ
```

Accept/deny 透過 v1 operation；order details 透過 v2。接受期限必須由營運監控；Uber 文件的 11.5 分鐘上限不是用來延長處理時間的 SLA。Ready/ready-time endpoint generation 尚未鎖定，因此 adapter 不宣告 `ORDER_READY`，對應 flags OFF。
