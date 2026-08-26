# Sandbox 測試計畫

每個 Provider 個別執行並留下 provider、環境、commit、時間與 sanitized receipt。

1. 連線：有效／無效憑證、scope 最小化、rotation、revoke。
2. 合約：schema version、未知欄位、缺欄位、最大 payload。
3. 安全：簽章錯誤、過期 timestamp、replay、SSRF、redaction。
4. 訂單：建立、重複、亂序、取消、部分資料、Provider timeout。
5. 菜單：全量、增量、checksum、部分失敗、rollback。
6. 付款：authorize/capture/fail/refund/duplicate webhook/reconcile。
7. 可靠性：429、5xx、timeout、retry budget、DLQ、manual replay。
8. 稽核：所有 mutation 與人工 replay 都有 actor/request/evidence。

通過 Sandbox 不等於 Pilot 或 Production；每層需獨立證據。
