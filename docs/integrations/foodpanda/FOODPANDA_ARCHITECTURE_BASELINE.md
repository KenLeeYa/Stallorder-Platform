# foodpanda Architecture Baseline

## Repo baseline

整合建立於既有 provider-neutral foundation：connection/store mapping、external order ledger、durable webhook event、sync job/DLQ、audit log、merchant/admin UI 與 entitlement。Canonical `orders`/`order_items` 仍是營運權威；`external_orders` 只保存 provider ledger。

## Provider boundary

- Adapter：`src/server/delivery-platforms/providers/foodpanda/foodpanda-adapter.ts`
- Client：`foodpanda-client.ts`
- Webhook：`foodpanda-webhook.ts`
- Mapper：`foodpanda-normalizer.ts`
- Canonical route：`src/app/api/integrations/foodpanda/webhooks/orders/route.ts`

Connection 必須同時綁定 organization、stall、chain、vendor/store 與 credential reference。訂單、event、job 的 idempotency 均包含 connection，避免不同 merchant 互相碰撞。

## 已知邊界

目前未實作 catalog read、full menu push、product creation、通用 outlet write。Adapter 未宣告這些 capability，對應 flags 保持 OFF。
