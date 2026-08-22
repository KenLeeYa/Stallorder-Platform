# foodpanda API Mapping

| 用途 | Method / path | Auth | Flag | 狀態 |
|---|---|---|---|---|
| App token | `POST /v2/oauth/token` | client credentials | Partner API | 已實作 |
| Get order | `GET /v2/chains/{chain_id}/orders/{order_id}` | Bearer | Orders | 已實作 |
| Update order | `PUT /v2/chains/{chain_id}/orders/{order_id}` | Bearer | Provider actions + Orders | 已實作 |
| Reconcile | `GET /v2/chains/{chain_id}/vendors/{vendor_id}/orders` | Bearer | Orders | 已實作，最多回看 60 天 |
| Availability | `PUT /v2/chains/{chain_id}/vendors/{vendor_id}/catalog` | Bearer | Catalog write | 已實作 active 狀態 |
| Catalog read | `GET /v2/chains/{chain_id}/vendors/{vendor_id}/catalog` | Bearer | Catalog read | 未實作 |
| Product create beta | `POST /v2/chains/{chain_id}/catalog` | Bearer | Product beta | 未實作、OFF |

Base URL 固定為程式內 allowlist：sandbox `https://sandbox.partner.deliveryhero.io`；production `https://foodpanda.partner.deliveryhero.io`。使用者輸入不可改寫 origin。

Webhook canonical route：`POST /api/integrations/foodpanda/webhooks/orders`。Webhook payload 是完整訂單；成功持久化後回空 body `200`。
