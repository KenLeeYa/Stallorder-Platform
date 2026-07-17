# StallOrder 產品與工程總計畫

## 產品目標

StallOrder（攤點通）讓夜市、市集、餐車與小型餐飲商戶用現場 QR、既有手機與人工現金流程接單，不要求昂貴 POS。初版優先確保：顧客能安全下單、店員能即時確認、商戶能管理供應與每日營運，平台能以單一 SaaS 安全服務多組織多攤位。

## 不可妥協原則

- 一個 frontend、Supabase project、PostgreSQL database 與 codebase。
- Organization 為 tenant/計費邊界；Stall 為營運位置。
- Auth 與 authorization 分離，client scope/role 永不可信。
- 32 張 public 業務表強制 RLS，匿名無直接訂單寫入。
- 公開點餐只有受信任 Edge Function 可建立 session/order。
- 訂單先 `WAITING_CONFIRMATION`，人員確認前不製作。
- 歷史訂單使用 snapshot，不由目前商品/價格回算。
- 所有高風險操作需 CSRF、RBAC、scope、確認與 audit。
- 新功能需繁體中文、mobile-first、可監控、可回復。

## 初版能力

1. QR abuse prevention：QR state、短效單次 session、Turnstile、多維 rate limit、限制與安全日誌。
2. Staff operations：即時/SSE/輪詢、確認、製作、取餐碼、現金結帳、防誤取消。
3. Merchant catalog：分類/群組/商品 CRUD、soft disable、售罄與排序。
4. Multi-stall foundation：organization/stall memberships、workspace、RLS、跨 tenant/stall 拒絕。
5. Shared catalog：organization master、多攤分派、每攤價格與供應覆寫。
6. Reporting：daily summaries、多攤 Dashboard、比較、報表與安全 CSV。
7. Operations：Realtime events、alerts、batch controls、audit/monitoring。
8. Commercial：plans、subscription、額外攤位核准、invoice/usage、Email invitation。

## 交付閘門

每次 release 必須：

- migration 可由 fresh database 完整套用。
- pgTAP 覆蓋新增 RLS、constraint、跨 scope 正反案例。
- lint、typecheck、unit/integration、build、E2E 全綠。
- `npm audit` 與 Supabase db lint 無未處理高風險問題。
- 無 secrets、測試產物或 production dump 進入 Git。
- 文件、migration/rollback、monitoring 與值班 runbook 同步。

## 上線前尚需外部決策

- 真實 Google Cloud/Supabase OAuth 憑證與 production smoke test。
- 方案 base fee、included/excess orders 及 Enterprise 合約值。
- 保存期限、資料刪除與商戶合約/隱私條款。
- Hosting、集中式 logging、告警通知與值班 owner。

## 後續優先順序

P0 完成 OAuth/定價部署；P1 modifier 共用化、摘要/帳務自動對帳與更多 alert detector；P2 以真實流量資料決定 partition、retention、queue 或 organization summary table。不得在沒有量測前加入額外基礎設施。

詳細工作見 [ROADMAP.md](ROADMAP.md) 與 [MULTI_STALL_GITHUB_ISSUES.md](MULTI_STALL_GITHUB_ISSUES.md)。
