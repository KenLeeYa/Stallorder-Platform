# Provider Readiness Matrix

| Provider | Architecture | Mock | Contract | Sandbox | Pilot | Production | Notes |
|---|---|---|---|---|---|---|---|
| ECPay | ARCHITECTURE_READY | MOCK_VERIFIED | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | 官方 host 已辨識；簽章與商家契約未驗證 |
| ezPay | ARCHITECTURE_READY | MOCK_VERIFIED | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | 只有公開文件入口，live adapter fail-closed |
| TradeVan | ARCHITECTURE_READY | MOCK_VERIFIED | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | 公開產品頁不足以形成 API contract |
| CUSTOM | ARCHITECTURE_READY | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | 預設 Disabled，不接受任意 endpoint |

`MOCK_VERIFIED` 不代表 `CONTRACT_VERIFIED`、`SANDBOX_VERIFIED` 或 `PRODUCTION_VERIFIED`。目前全系統 readiness 上限為 `LOCAL_MOCK_READY`。

