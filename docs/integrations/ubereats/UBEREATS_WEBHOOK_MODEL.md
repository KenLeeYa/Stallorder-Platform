# Uber Eats Webhook Model

Uber event payload 只信任下列經 schema 驗證欄位：`event_id`、`event_type`、`meta.resource_id`（order）、`meta.user_id`（store）與 `resource_href`。

```mermaid
sequenceDiagram
  participant U as Uber
  participant W as Webhook
  participant D as Database
  participant Q as Worker
  U->>W: Signed raw event
  W->>W: HMAC + environment + schema
  W->>D: Insert event (connection-scoped replay key)
  W->>D: Enqueue priority ORDER_FETCH
  W-->>U: 200 empty body
  Q->>U: GET /v2/eats/order/{id}
  Q->>D: Stage external order + ORDER_IMPORT
```

重複 event 回同一 durable 結果，不建立第二筆 canonical order。驗證失敗、unknown store、origin/path 不符、payload 過大均 fail closed。
