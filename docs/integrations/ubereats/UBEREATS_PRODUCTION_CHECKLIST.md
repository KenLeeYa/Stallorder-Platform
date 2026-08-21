# Uber Eats Production Checklist

- [ ] Uber partner/legal/licensing 與 production app 完成。
- [ ] Testing app、test store、verification 全通過。
- [ ] Production scopes whitelist 且在 Dashboard 啟用。
- [ ] Production callback、Primary Webhook URL、DNS/TLS 已驗證。
- [ ] Application/webhook/merchant token secrets 分離並存 secret manager。
- [ ] Merchant OAuth completion + encrypted token sink 已實作與測試。
- [ ] Store discovery/activation 與 disconnect/revoke 已實作與測試。
- [ ] Sandbox E2E、HMAC、SSRF、duplicate、deadline、DLQ、rollback drill 通過。
- [ ] Pilot store、監控閾值與 on-call owner 已核准。
- [ ] 未實作 generations 的 flags 保持 OFF。
- [ ] Staging 合併並驗證，建立 fresh immutable Production Plan ID。
- [ ] 取得綁定該 Plan ID 的 Apply approval。

任一 blocking 項未完成：`NOT READY`。
