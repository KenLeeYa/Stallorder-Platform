# Uber Eats API Mapping

| 用途 | Method / path | Generation | Scope | Grant | Flag | 狀態 |
|---|---|---|---|---|---|---|
| App token | `POST /oauth/v2/token` | OAuth v2 | per request | client_credentials | API | 已實作 |
| Merchant authorize | `GET /oauth/v2/authorize` | OAuth v2 | `eats.pos_provisioning` | auth code + PKCE | OAuth | begin 已實作；completion 未實作 |
| Get order | `GET /v2/eats/order/{order_id}` | v2 | `eats.order` | client_credentials | Orders | 已實作 |
| Accept | `POST /v1/eats/orders/{order_id}/accept_pos_order` | v1 | `eats.order` | client_credentials | Provider actions + Orders | 已實作 |
| Deny | `POST /v1/eats/orders/{order_id}/deny_pos_order` | v1 | `eats.order` | client_credentials | Provider actions + Orders | 已實作 |
| Sparse item update | `POST /v2/eats/stores/{store_id}/menus/items/{item_id}` | v2 | `eats.store` | client_credentials | Menu item write | 已實作 suspension |
| Ready / ready time | 未鎖定 endpoint generation | — | — | — | Ready flags | 未實作、OFF |
| Menu read/full write | 未接線 | — | — | — | Menu flags | 未實作、OFF |
| Store/holiday/reports | 未接線 | — | — | — | 對應 flags | 未實作、OFF |

Origins 固定在程式 allowlist：sandbox auth `https://sandbox-login.uber.com`、API `https://test-api.uber.com`；production auth `https://auth.uber.com`、API `https://api.uber.com`。
