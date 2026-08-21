# foodpanda Manual Actions

本檔是 foodpanda 外部人工工作唯一清單。

| Item | Required value/action | Owner | Environment | Blocking | Status |
|---|---|---|---|---|---|
| Partner approval | 取得核准 | Human/foodpanda | Production | Yes | Pending |
| Partner Portal / Shops Integrations Plugin | 開通帳號與權限 | foodpanda/Human | Both | Yes | Pending |
| Integration type | 確認 POS integration mode | foodpanda AM | Both | Yes | Pending |
| Sandbox credentials | 建立 client ID，secret 存 secret manager | Human | Sandbox | Yes | Pending |
| Sandbox identifiers | 確認 chain ID 與 vendor ID | Human | Sandbox | Yes | Pending |
| Production credentials | 建立 client ID，secret 存 secret manager | Human | Production | Yes | Pending |
| Production identifiers | 確認 chain ID 與 vendor mappings | Human | Production | Yes | Pending |
| Webhook endpoint | 設定 canonical URL 與 Authorization 值 | Human | Both | Yes | Pending |
| Public DNS/TLS | 建立並驗證憑證 | Infra | Production | Yes | Pending |
| Sandbox E2E | 執行並保存證據 | QA/Human | Sandbox | Yes | Pending |
| Pilot | 選定商家、窗口與 rollback owner | Business/Ops | Production | Yes | Pending |
| Add Products beta | 如需使用，取得書面 early-access 核准 | foodpanda | Production | Optional | Pending |
| Production Plan/Apply | 建 fresh Plan ID 並取得 plan-bound approval | Release owner | Production | Yes | Pending |
