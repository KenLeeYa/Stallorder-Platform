# StallOrder 商業模式

## 客群

- 夜市與市集多攤品牌
- 餐車、快閃店、活動型攤位
- 一至數十個小型門市/攤位的餐飲經營者
- 仍以現金與現場取餐為主、不需要大型 POS 的商家

## 價值

- 顧客免下載 App，掃 QR 即可下單。
- 店員用手機即時確認，降低口頭點單錯誤。
- 現金流程不中斷，導入成本低。
- 共用商品主檔減少多攤重複維護，仍保留每攤價格/售罄彈性。
- Owner 能看跨攤銷售、訂單、付款與營運警示。
- 邀請、RBAC、RLS、audit 與防濫用可支援正式商務營運。

## 現行 PAYG 收入模型

```text
每個攤位的淨完成訂單 × TWD 1
（每個攤位每月最高 TWD 1,499）
+ 另行核准的外部加購服務
```

平台無基本月費；取消、拒絕、逾時訂單不計費，完整退款以負向可信事件折抵。顧客付款金流手續費不包含在每筆 TWD 1 的平台費內。開放測試期間仍保存可信用量，但預設不建立收費 Invoice；完整契約與 rollout flags 見 [PAYG 計費模型](PAYG_BILLING_MODEL.md)。

## Legacy Phase 1 收入模型（歷史參考）

```text
月方案底價
+ 超過 included stalls 的核准攤位費
+ 超過 included orders 的用量費
+ 未來 feature add-ons
```

以下 Lite／Standard／Pro 與額外攤位流程只支援既有固定價格 Subscription，不再是新商家方案目錄。Enterprise 仍可依合約設定；既有人工核准、audit 與 line item 保留供歷史帳務使用。

## 成本與風險

- Supabase DB/Auth/Realtime/Edge、hosting、Turnstile、logging/monitoring。
- 尖峰 QR/session 與 Realtime fan-out；以限流、summary、篩選訂閱控制。
- 現金付款有對帳風險；用 pickup verification、payment records、daily summary 與 alerts 降低。
- Abuse/假單風險；用 one-use session、Turnstile、多維限制與 staff confirmation。
- 商家離線/忙碌風險；用 pause/close、pending alerts、Realtime fallback。

## 方案治理

正式價格不寫死前端，必須由 `plans` migration/受稽核管理流程更新。方案變更需版本、生效日、合約/稅務確認、invoice 對帳與回復方法。目前 base/excess 價格為保守未設定值，不能直接視為免費正式方案。

## 產品指標

- 商家申請送件／補件／核准轉換、核准至完成測試訂單與 Go-live 時間。
- Activated organizations、active stalls、完成 onboarding 時間。
- QR session→order conversion、Turnstile/rate-limit rejection。
- Waiting confirmation time、expired/cancelled/unpaid rate。
- Orders、GMV、平均客單、各攤比較。
- Realtime fallback duration、staff confirmation latency。
- Additional stall adoption、invoice accuracy、usage reconciliation gap。
- Merchant retention 與 support incidents。

指標必須以 organization/stall scope 聚合，不跨租戶暴露；用量統計不得把同一人跨 membership 重複計數。

## Legacy Phase 1 收費模式

方案以不可回溯修改的 Plan Version 保存；Trial、Lite、Standard、Pro 與其固定月費 Invoice 流程保留支援既有合約。新商家使用 PAYG；PAYG 必須經專用遷移／關帳工作流，不可送入 FIXED Invoice 流程。自動扣款、電子發票、MRR／ARR／churn 仍為後續階段，不能列為目前營收自動化能力。
