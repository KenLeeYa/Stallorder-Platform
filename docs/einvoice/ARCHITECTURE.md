# 架構

```text
顧客結帳 -> Checkout Preference -> Order / Payment
                                    |
商家操作 / future job -> Invoice Orchestrator
                         |-> PolicyVersion（不可變）
                         |-> ProviderOperation（防重、retry、DLQ）
                         |-> Provider Adapter
                              |-> LOCAL MOCK（目前可用）
                              |-> ECPay / ezPay / TradeVan（fail-closed）
                         |-> InvoiceDocument
                         `-> ReconciliationCase（只標記，不自動改帳）
```

## 權威資料

- 訂單、付款、金額、幣別、攤位及完成狀態一律由伺服器讀取。
- 瀏覽器只送 buyer selection 與操作意圖，不能指定發票總額、稅額或 Provider endpoint。
- `organizationId` 必須沿 API、service、composite FK、operation key 與 Provider context 全程傳遞。
- Provider 回應只更新發票 domain；不得自動改寫訂單與付款真相。

## 執行環境

- Local/Test：只有在 runtime policy 明確判定 dev mode 時可取得 Mock adapter。
- Production：Mock 禁止；正式開票 flag 若被單獨打開，runtime gate 仍會拒絕。
- Provider endpoint 由程式碼 allowlist 定義，不接受商家輸入任意 URL。
