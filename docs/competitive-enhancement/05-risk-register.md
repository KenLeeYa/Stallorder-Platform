# 風險登錄表

| 風險 | 影響 | 控制 | 剩餘風險／Gate |
| --- | --- | --- | --- |
| 跨組織資料外洩 | Critical | server RBAC、org scope、FORCE RLS、無 authenticated grant | RLS integration test 必須通過 |
| Provider 憑證外洩 | Critical | hash/reference、一次顯示、Vault、redaction | 真實憑證只在核准環境設定 |
| Webhook SSRF/DNS rebind | High | HTTPS、443、禁止私網、啟用前 DNS 驗證 | 受控 egress 前投遞 OFF |
| 重複訂單／扣庫 | High | idempotency、transaction、advisory lock、immutable ledger | 並行整合測試 |
| 菜單誤發布 | High | draft/review/publish、checksum、publication receipt | 正式 rollout 採單一組織 canary |
| 未經同意行銷 | Critical | Consent hard-lock、用途與版本欄位 | 法務／隱私核准前不發送 |
| 活動歸因誤導 | High | 簽章 token、estimate/confidence、capture OFF | 雙下單路徑 parity 前不產生歸因 |
| 指標定義漂移 | Medium | KPI 字典、固定來源、顯示限制 | 每次 schema/算法變更需版本審查 |
| 外部整合誤標 Ready | High | 狀態生命週期與保守判定 | Sandbox/Pilot/Production 證據分離 |
| 本機變更污染使用者工作區 | High | 獨立 worktree；原 dirty checkout 不寫入 | 合併前人工確認差異 |
