# Uber Eats Architecture Baseline

Uber 整合使用既有 connection/store mapping、external order ledger、durable webhook、priority sync job、audit、RLS、merchant/admin UI 與 entitlement。

## Provider components

- Adapter：`src/server/delivery-platforms/providers/uber-eats/uber-eats-adapter.ts`
- Client：`uber-eats-client.ts`
- OAuth config/authorize：`uber-eats-oauth.ts` 與 adapter `beginConnection`
- Webhook：`uber-eats-webhook.ts`
- Mapper：`uber-eats-normalizer.ts`
- Canonical route：`src/app/api/integrations/ubereats/webhook/route.ts`

Uber webhook 只提供 event/resource reference；gateway 驗證 raw-body HMAC 後，寫入 durable event 並建立高優先 `ORDER_FETCH` job。Worker 再以 fixed-origin client 取得完整 order，驗證 store，寫 external ledger，最後 enqueue canonical import。

Canonical `orders`/`order_items` 是營運權威。Provider payment 不會被誤當成 StallOrder 現金交易。
