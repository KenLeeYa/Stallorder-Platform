# Uber Eats Manual Actions

本檔是 Uber Eats 外部人工工作唯一清單。

| Item | Required action/value | Owner | Environment | Blocking | Status |
|---|---|---|---|---|---|
| Partner alignment/legal | Marketplace/POS、NDA、licensing | Human/Uber | Production | Yes | Pending |
| Testing Developer App | 建立 Eats Marketplace testing app | Human | Sandbox | Yes | Pending |
| Sandbox credentials | client ID/secret 存 secret manager | Human | Sandbox | Yes | Pending |
| Test store | 向 Integration Tech Support 申請 | Uber | Sandbox | Yes | Pending |
| Sandbox webhook | 設定 Primary Webhook URL/secret | Human | Sandbox | Yes | Pending |
| Sandbox E2E | 執行並保存證據 | QA/Human | Sandbox | Yes | Pending |
| Uber verification | 排程並完成 | Uber/Human | Pre-Prod | Yes | Pending |
| Production app | 建立獨立 production account/app | Human | Production | Yes | Pending |
| Production credentials | client ID/secret 存 secret manager | Human | Production | Yes | Pending |
| Scope whitelist | 申請並在 Dashboard 啟用必要 scopes | Uber/Human | Production | Yes | Pending |
| OAuth redirect | 設定 exact HTTPS URI | Human | Production | Yes for OAuth | Pending |
| Production webhook | 設定 Primary URL、DNS、TLS | Infra/Human | Production | Yes | Pending |
| Pilot store/provisioning | 選定並關聯 production app | Uber/Human | Production | Yes | Pending |
| Menu ownership | 確認 API 或人工 source of truth | Human/Uber | Production | Yes for writes | Pending |
| Advanced scopes | ready/fulfillment/reports generations 核准 | Uber | Production | Optional | Pending |
| Production Plan/Apply | fresh Plan ID + plan-bound approval | Release owner | Production | Yes | Pending |
