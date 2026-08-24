# foodpanda Production Checklist

- [ ] Partner approval、portal access、production client、chain/vendor IDs 完成。
- [ ] Secrets 位於 production secret manager，Preview/Production 不共用。
- [ ] Public webhook DNS/TLS 與 Authorization 已驗證。
- [ ] Migration dry-run、backup、restore、RLS、DB lint、CI/build 全通過。
- [ ] Sandbox E2E、replay、timeout、DLQ、reconciliation 與 rollback drill 通過。
- [ ] Pilot stall/organization allowlist 與責任人已核准。
- [ ] Feature Flag 逐層啟用；product beta 永遠 OFF，除非另有 foodpanda 書面核准。
- [ ] 監控 error rate、webhook lag、duplicate、DLQ、order amount mismatch。
- [ ] Staging 已合併且測試通過，建立 fresh immutable Production Plan ID。
- [ ] 取得綁定該 Plan ID 的 Apply approval。

任一項未完成：`NOT READY`，不得 Production Apply。
