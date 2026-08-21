# Delivery Providers Manual Actions

更新日期：2026-08-21

以下項目需要 partner portal、protected secret store、Staging/Production environment 或人工 approval；本次本機更新未執行。

## 共用順序

1. 由 owner 取得 provider app、Sandbox credentials、test store 與 scope approval；只保存 secret reference，不貼值到 ticket、Git 或聊天。
2. 在 Staging secret store 建立 client/webhook secrets，建立 connection/store mapping，保持所有 write flags OFF。
3. 對 canonical webhook URL 完成 provider portal 設定與 DNS/TLS 驗證。
4. 在相同 immutable revision 套用 additive migration，執行 cross-tenant、duplicate webhook、deadline、menu-empty-wipe、SSRF/redirect 與 rollback tests。
5. 逐一開啟單一 canary connection 的 orders，再視已驗證 capability 開啟 actions/menu；記錄 queue、DLQ、latency、error rate 與 reconciliation evidence。
6. Staging Gate 全綠後建立新的 immutable Production Plan ID，取得 plan-bound approval；不得沿用舊 approval。
7. Production Apply 後執行 smoke、webhook、queue、audit 與 rollback readiness；任一 Gate 失敗立即關閉最小範圍 flag。

## foodpanda 外部項目

- Partner/API app、country/chain/vendor/store identifiers、Sandbox/Production endpoints 與 scopes。
- Webhook Authorization 值與 portal callback 設定。
- Order/status/history/item availability contract、rate limit 與 idempotency confirmation。
- Catalog/menu/product beta capability 需另行核准後才可實作及啟用。

詳情：[FOODPANDA_MANUAL_ACTIONS.md](foodpanda/FOODPANDA_MANUAL_ACTIONS.md)

## Uber Eats 外部項目

- Developer app、redirect URI、webhook URL、client credentials、required Eats scopes 與 test store。
- Authorization-code exchange、encrypted merchant token storage、refresh/revocation 與 store activation 完成後才可開 OAuth activation。
- Uber webhook verification、order accept/deny、item suspension、deadline 與 idempotency contract evidence。
- Menu、store hours、reports/reconciliation 需依已核准 scope 分階段落地。

詳情：[UBEREATS_MANUAL_ACTIONS.md](ubereats/UBEREATS_MANUAL_ACTIONS.md)
