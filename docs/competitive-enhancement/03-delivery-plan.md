# 交付計畫

| 階段 | 交付 | 本機狀態 | Gate |
| --- | --- | --- | --- |
| 0 | 稽核、差距、架構、風險 | 完成 | 基準 Gate |
| 1 | 模組 flags、整合目錄、共用安全 | 完成 | Unit + typecheck |
| 2 | 通路感知菜單與 HQ 治理 | 完成 | Migration + API/UI tests |
| 3 | KDS/取餐盤點 | 重用既有 | 全量回歸 |
| 4 | Omni/LINE/外送/付款/發票盤點 | 安全基礎 | Provider 前維持 OFF |
| 5 | Growth foundation | 完成可控部分 | Consent hard-lock |
| 6 | Event Growth | 管理可測；歸因 OFF | 雙路 parity 才開 |
| 7 | Supply Lite | 完成 | Ledger/idempotency tests |
| 8 | Public API/Webhook | 唯讀 API 可測；投遞 OFF | Scope/signature/SSRF tests |
| 9 | Advanced Analytics | 完成 | KPI definition tests |
| 10 | Security/RLS/Reliability | 本機驗證中 | RLS/grant/audit checks |
| 11 | Full Gates | 待最終執行 | lint/type/test/build/audit |
| 12 | Setup Center/Docs | 完成中 | 文件路徑與狀態核對 |
| 13 | Rollout | 僅提供計畫 | 需使用者另行核准 |

任何 Gate=FAIL 都停止發布，不以關閉測試或降低安全控制換取通過。
