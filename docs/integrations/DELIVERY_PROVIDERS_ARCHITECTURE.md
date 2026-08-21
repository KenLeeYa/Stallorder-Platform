# Delivery Providers Architecture

更新日期：2026-08-21

## 系統邊界

StallOrder 以 provider-neutral domain 承接 foodpanda 與 Uber Eats。`orders`、`order_items` 仍是營運權威；`delivery_platform_connections`、store mappings、webhook events、external orders、sync jobs 與 audit logs 保存外部平台狀態與證據。所有 event、order 與 job 的 durable key 都包含 connection，避免不同 merchant 的 provider ID 碰撞。

## 資料流

1. 公開 canonical webhook route 先執行 method、content type、rate limit 與 128 KiB bounded stream read。
2. Provider verifier 對 raw body 執行 foodpanda Authorization 或 Uber HMAC/environment 驗證。
3. Connection/store mapping、tenant association 與 replay key 通過後，才 durable persist event。
4. foodpanda 完整 order payload 可直接正規化；Uber resource event 先建立高優先 `ORDER_FETCH` job，再由 fixed-origin client 抓取完整 order。
5. External order ledger 通過 schema、store、currency 與 money checks 後，排入 canonical import/action job。

## Provider components

| 邊界 | foodpanda | Uber Eats |
|---|---|---|
| Canonical route | `/api/integrations/foodpanda/webhooks/orders` | `/api/integrations/ubereats/webhook` |
| Adapter | `providers/foodpanda/foodpanda-adapter.ts` | `providers/uber-eats/uber-eats-adapter.ts` |
| Client | `foodpanda-client.ts` | `uber-eats-client.ts` |
| Authentication | client credentials + webhook Authorization | client credentials, authorize URL/PKCE + raw-body HMAC |
| Normalizer | `foodpanda-normalizer.ts` | `uber-eats-normalizer.ts` |

## Runtime controls

- 共用 outbound client 固定 base origin、拒絕 `//` 與跨 origin path、timeout、bounded response、單次 401 refresh，且所有 redirect fail closed。
- 共用 Feature Flag、provider flag、orders/menu/actions flag 與 entitlement 均預設關閉。
- Queue 採 bounded retry/backoff、DLQ 與 audit；native StallOrder ordering 不依賴 delivery provider flag。
- Secret 只以 allowlisted reference 解析，不把 raw provider credential 寫入公開 DB、log 或 audit。

## 尚未完成的 capability

Uber authorization-code exchange/encrypted merchant token sink、store discovery/activation，以及兩個 provider 的完整 menu/catalog/reconciliation capability 尚未完成；adapter 不宣告未實作能力，相關 flags 必須維持 OFF。

Provider 細節：

- [foodpanda architecture](foodpanda/FOODPANDA_ARCHITECTURE_BASELINE.md)
- [Uber Eats architecture](ubereats/UBEREATS_ARCHITECTURE_BASELINE.md)
