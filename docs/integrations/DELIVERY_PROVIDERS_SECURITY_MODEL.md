# Delivery Providers Security Model

更新日期：2026-08-21

## 保護資產與信任邊界

保護資產包含 tenant-isolated orders/customer data、catalog/order integrity、provider credentials、webhook replay state、queue availability 與 release evidence。Internet webhook、OAuth/provider response、background worker、PostgreSQL/Supabase 與 release control plane 均是獨立信任邊界。

## 必要控制

- Public webhook：只接受 JSON POST；先以 incremental reader 限制 128 KiB 並在超限時 cancel stream，再進行 provider authentication。
- OAuth/provider response：token 上限 32 KiB；API response 使用 configurable cap；不得先完整 buffer 再檢查。
- Redirect：OAuth client-secret POST 與 provider API request 使用 manual redirect，任何非預期 3xx 均 fail closed，避免 SSRF、secret/body forwarding。
- Tenant：所有 connection、store、order、event、job lookup 必須同時驗證 organization/stall/provider association。
- Authentication：foodpanda Authorization 與 Uber HMAC 使用 constant-time compare；Uber 同時驗證 raw body、environment 與 known resource reference。
- Replay：connection-scoped durable unique key、payload hash 與 idempotent persistence；不得依賴 process memory 去重。
- Data：strict schema、bounded strings/arrays、精確 money conversion、customer data minimization；provider payment 不建立 StallOrder cash payment。
- Secrets：DB 僅保存 allowlisted secret reference；不得把 token、secret、Authorization、完整電話或 raw payload 寫入 log/audit。
- Rollout：所有 provider/write flags 預設 OFF；Production runtime 禁止 sandbox provider environment。

## 2026-08-21 security revalidation scope

首次 locked diff scan 發現 6 項：2 個 webhook body late-limit、2 個 outbound response late-limit、2 個 redirect SSRF/forwarding。修正已加入共用 bounded reader、stream cancellation 與 redirect fail-closed，並以 unit tests 與本機 two-origin PoC 重現驗證。重驗 scan `56bd9b18-ecd4-41d4-a899-d47d08e8ffb4` 已封存：coverage complete、324/324 rows closed、0 candidates、0 findings。

## 未驗證風險

- Production ingress 的 preventive byte cap 與 runtime egress segmentation 尚無部署證據。
- Provider Sandbox 的 redirect contract、HMAC/Authorization 實際 header 與 rate-limit 行為尚未 live 驗證。
- 自動 mutation 在 ambiguous timeout/401 後的 provider idempotency contract 仍需 partner confirmation。

Provider 細節：

- [foodpanda security](foodpanda/FOODPANDA_SECURITY_MODEL.md)
- [Uber Eats security](ubereats/UBEREATS_SECURITY_MODEL.md)
