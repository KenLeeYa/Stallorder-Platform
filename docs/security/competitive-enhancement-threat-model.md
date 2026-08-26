# 系統強化 Threat Model

## 資產

- 組織／攤位訂單、商品、顧客同意、付款與庫存資料。
- API Key、Webhook secret reference、Provider credentials。
- 菜單發布權、優惠預算、庫存 ledger、活動歸因與稽核紀錄。

## 信任邊界

1. Browser／手機與 Next.js server。
2. Server 與 PostgreSQL/Supabase。
3. Server 與外部 Provider／Webhook destination。
4. Organization 與 Stall、多組織平台管理者。

## 主要威脅與控制

| 威脅 | 控制 |
| --- | --- |
| IDOR／跨租戶讀寫 | server RBAC、organization/stall scope、FORCE RLS、FK scope |
| CSRF | merchant mutation CSRF validation、same-site session |
| API Key 竊取 | hash-only、prefix、一次顯示、expiry、revoke、scope |
| Webhook 偽造／重播 | HMAC、timestamp、payload hash、event idempotency |
| SSRF／DNS rebind | HTTPS 443、禁止 private/loopback、DNS validate、受控 egress 前 OFF |
| 重複扣庫／發券 | transaction、unique idempotency、immutable ledger |
| 菜單越權發布 | lifecycle、permission、audit、checksum、Feature flag |
| 未經同意行銷 | Consent hard-lock、purpose/version、withdrawal、frequency cap |
| 歸因竄改 | server HMAC token、expiry、hash storage、capture parity gate |
| 敏感資料進 log | metadata allowlist、error sanitization、不得記錄 secret/raw PII |

## 必要驗證

- 每張新表：RLS enabled + forced、anon/authenticated 無 grant、service role 最小 grant。
- 每個 mutation API：unauthorized、cross-org、CSRF、validation、audit 測試。
- 每個外部入口：signature、replay、rate limit、payload limit、timeout 測試。

本機通過不等於 Production security sign-off；正式 rollout 前需 security diff scan 與 evidence review。
