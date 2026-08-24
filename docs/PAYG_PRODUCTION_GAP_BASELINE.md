# PAYG Production Gap Baseline

本文件記錄 2026-08-24 本機來源狀態，不能當作 Staging 或 Production 啟用證明。

| 能力 | Source | Local QA | Staging | Production enabled |
| --- | --- | --- | --- | --- |
| TWD 1／完成訂單、每攤位 TWD 1,499 cap | 已有 | 既有測試 | 未於本次驗證 | 否 |
| 明確計費時區與月界線 | 已完成 | 單元與 migration QA | 未驗證 | 否 |
| 明確稅務契約與 fail closed | 已完成 | 單元與 migration QA | 未驗證 | 否 |
| PlanVersion 封存、hash 與 entitlement 不可變 | 已完成 | 單元與資料庫 QA | 未驗證 | 否 |
| 付款後／稅務文件後的完整退款折抵 | 已完成 | migration QA | 未驗證 | 否 |
| 自動關帳 executor、durable job 與 retry | 已完成 | 單元 QA | 未驗證 | 否 |
| Production read-only audit | 已完成 | 待接本機有效資料 fixture | 未驗證 | 否 |

既有 PAYG v1 保持 `tax_treatment=UNCONFIGURED`、未封存，不會因 migration 被改造成另一份法律或價格契約。所有收費及自動關帳 flags 維持 OFF。
