# 商業帳務測試計畫

## 自動化層級

| 層級 | 主要覆蓋 |
| --- | --- |
| Unit | 方案版本、權益、限制、狀態轉換、金額、warning、Provider fail closed |
| Database / pgTAP | RLS、租戶隔離、複合外鍵、唯一事件、交易鎖、feature flags |
| Integration | Invoice -> payment -> verification -> activation、停權、重建用量 |
| Playwright | Merchant／Admin UI、mobile、付款、Invoice、訂閱警示 |
| Build / static | Prisma、TypeScript、ESLint、Next.js routes、secret scan |

## 必要案例

- Trial 日期到期與 100 筆完成訂單硬限制。
- 付費方案 80／90／100／110% 警示且 100% 不停止營業。
- 重複 billable event、重複 idempotency key、並行數量限制。
- 銀行轉帳、現金、人工 LINE Pay、其他付款。
- 部分付款保持 `OPEN`；完整付款成為 `PAID` 並啟用 Subscription。
- 拒絕付款不增加 `amount_paid`。
- Suspension 阻擋新公開 session／order，但保留登入、歷史與帳務資料。
- Owner／Finance／Admin／Staff／Kitchen／Anonymous 權限正反案例。
- ECPay／NewebPay route 停用回 404；Mock invalid signature、duplicate event、amount/currency mismatch。
- 電子發票 Provider 停用且 UI 無可操作開立按鈕。

## Staging 驗收紀錄（2026-07-19）

- Standard 月繳方案申請、Invoice 建立、四種人工付款、逐筆審核與最終啟用均通過。
- 三筆部分付款後 Invoice 保持 `OPEN`；最後一筆後為 `PAID`，Subscription 為 `ACTIVE`。
- 停權後資料庫公開訂單 gate 回 `SUBSCRIPTION_SUSPENDED`；恢復後回 `OK`。
- 2,200 筆付費用量重建後產生 80／90／100／110% 四級 warning，訂單 gate 仍為 `OK`。
- Trial 在 99 筆為 `OK`、100 筆為 `TRIAL_ORDER_LIMIT_REACHED`；到期為 `TRIAL_EXPIRED`。
- P4 五張 future table 均 FORCE RLS、service-only；外部 provider flags 為 false。
- ECPay 與 NewebPay Staging webhook 實際回 `SERVICE_NOT_ENABLED`，沒有寫入 future tables。

## 已知 Staging 限制

Preview 瀏覽器直連 Staging Edge Function 受既有 CORS／DNS 環境限制；本次已驗證 Edge 使用的資料庫 billing gate 與 Next.js 工作流，但未宣稱完成該瀏覽器跨來源路徑。不得為通過測試而放寬 CORS。

## Release gate

執行 `npm ci`, lint, typecheck, unit, db:test, Supabase db lint, build, E2E 與 npm audit。任何安全、資料隔離、付款交易或 Build 失敗都阻擋 merge。

