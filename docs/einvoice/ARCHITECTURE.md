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

## 手機大量文件呈現（2026-10-02）

小於 768px 的既有文件紀錄先顯示 6 筆，可增加／收合；已載入文件的對帳差異數仍完整顯示，權限、Mock 與正式開立停用規則不變。範圍與驗證邊界見 [手機營運清單](../architecture/mobile-operational-lists.md)。

供應商狀態卡片採可縮寬的 grid/card 與機器碼斷行，避免 OFFICIAL_DOWNLOAD_REQUIRED 等完整狀態在 320px 撐開頁面；不截斷或隱藏狀態。operations-mobile-records.test.ts 使用實際供應商定義與記憶體編譯的 globals.css／Tailwind，覆蓋 320／390／768／1440 的頁面、卡片及文字寬度。實際建置頁面仍由 runtime owner 驗收。
