# Uber Eats Security Model

## Webhook

- 對 raw UTF-8 body 計算 HMAC-SHA256 lower-case hex，constant-time 比對 `X-Uber-Signature`。
- 驗證 `X-Environment` 與 connection runtime 配對。
- body 上限 128 KB、只接受 JSON POST；成功 durable persist 後回空 body `200`。
- `resource_href` 只解析為 reference，並限制為已知 Uber API origin/path；實際抓單使用自行組成的 fixed path。

## OAuth and secrets

- authorize URL 固定 origin，要求 exact callback、state、PKCE S256 與 `eats.pos_provisioning`。
- client secret / webhook secret 只以 allowlisted reference 解析；token/secret 不進 log、audit 或公開 DB。
- application token cache 支援 expiry skew、timeout、single-flight 與一次 401 refresh。
- merchant auth code exchange 與 encrypted refresh-token sink 尚未完成，所以 OAuth activation 必須 OFF。

## Tenant and data

- candidate connection 依 provider/store 找出，驗證後再做 tenant/store association。
- event/order/job uniqueness 包含 connection，防止跨 merchant collision。
- customer phone 最小化，provider payment 不建立 cash payment。
