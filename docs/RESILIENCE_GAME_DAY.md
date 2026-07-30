# 生產韌性 Game Day

日期：2026-07-29

## 安全範圍

自動故障注入只允許：

- Local Supabase CLI 與 synthetic seed。
- Data-less 或 synthetic-only Ephemeral Validation。
- 本機 OAuth mock、Edge Functions、Next.js 與瀏覽器。

Production 只允許非破壞性 health、migration history、lag、Advisor、版本、
Storage manifest 與已核准 system canary。禁止 reset、demo seed、斷線注入與
破壞性 E2E。

## 執行前

1. 確認工作樹、commit、測試環境與操作者。
2. 確認 `DATABASE_URL` hostname 是 `localhost` 或 `127.0.0.1`。
3. 執行本機完整 reset，確認沒有 Production customer data。
4. 指派事故指揮、應用、資料、營運與觀察員。
5. 設定成功、停止與 rollback 條件。

## 自動化演練

列出完整矩陣：

```powershell
npm run resilience:game-day
```

驗證 DR／failback 腳本 dry-run 契約：

```powershell
npm run resilience:game-day -- --verify-dry-runs
```

此命令不支援 `--apply`，也不讀取或輸出資料庫秘密。

執行故障注入 E2E：

```powershell
npx concurrently --kill-others --success command-1 `
  "npm run functions:serve:e2e" `
  "npx playwright test e2e/resilience-failure-injection.spec.ts"
```

執行 production-mode 離線與 QR：

```powershell
$env:PLAYWRIGHT_PRODUCTION_SERVER='true'
npx concurrently --kill-others --success command-1 `
  "npm run functions:serve:e2e" `
  "npx playwright test e2e/offline-pwa-foundation.spec.ts e2e/qr-degraded-mode.spec.ts"
Remove-Item Env:PLAYWRIGHT_PRODUCTION_SERVER
```

## 故障卡

每個情境依 [FAILURE_MODE_MATRIX.md](FAILURE_MODE_MATRIX.md) 注入：

1. Realtime unavailable。
2. SSE unavailable。
3. Supabase Edge 503。
4. Next.js Circuit B 503。
5. Primary database unavailable／fenced。
6. DR unavailable。
7. Replication lag 超標。
8. Turnstile unavailable。
9. LINE Pay unavailable。
10. 街口支付 unavailable。
11. Storage quota pressure。
12. Service Worker version skew。

觀察員記錄：

- 偵測時間。
- 降級開始時間。
- 顧客、店員與廚房畫面。
- 是否存在 false success 或 duplicate。
- 安全控制是否仍生效。
- 復原時間與人工步驟。

## DR 桌上演練

依序口述並展示 dry-run receipt：

```text
Readiness
-> Primary freeze
-> DR promotion
-> DR active validation
-> Primary reconciliation
-> DR freeze
-> Primary promotion
-> Primary active validation
```

只要 migration、lag、Storage、Auth、sequence、付款 callback、requester／
approver 或 fencing 有一項缺漏，就必須停止。沒有核准的真實 DR 時，演練結果
只能標記 `DRY_RUN_PASS`，不能標記 `FAILOVER_PASS`。

## 通過條件

- 12 個故障卡都有自動化或明確人工證據。
- QR 在無安全 backend 時只讀，沒有假成功。
- Circuit fallback 不重複訂單。
- Staff 可顯示 SSE、Realtime 或 5 秒 polling。
- 離線訂單經關閉／重開頁面仍存在且同步只建立一筆 canonical order。
- Pending queue 阻止 Service Worker 安全更新；同步後回到 0。
- DR 與 failback dry-run 七個步驟全部符合契約。
- RLS、RBAC、CSRF、Turnstile、rate limit、idempotency 與 audit 未弱化。

## 本分支驗證紀錄

2026-07-29 在 Local Supabase 與 synthetic seed 完成：

- Game Day：12 個故障情境已列入計畫；7 個 DR／failback dry-run receipt 通過。
- 故障注入 E2E：2 項通過，涵蓋 Edge 503 切換 Circuit B，以及
  SSE／Realtime 同時失效後的 5 秒 polling。
- Production-mode E2E：離線 PWA 與 QR 降級共 3 項通過。
- 完整 Playwright：69 項通過，1 項僅限 production-mode 的案例依設計略過。
- Vitest：113 個測試檔、453 項測試通過。
- pgTAP：34 個測試檔、720 項測試通過。
- lint、typecheck、database lint、production build 與
  `npm audit --audit-level=moderate` 均通過。

本次沒有執行 `--apply`、沒有切換 Production backend，也沒有使用 Production
DR 做故障注入。因此結果為 `DRY_RUN_PASS`，不是 `FAILOVER_PASS`，且尚無可宣告
的 Production RTO／RPO。

## 訓練

每季至少一次：

- 讓不同人輪流擔任事故指揮與資料負責人。
- 由店員實際完成櫃台點餐、現金、人工付款、離線訂單與補印核對。
- 由管理者實際操作 QR 降級、feature flag rollback 與 incident update。
- 以 15 分鐘內完成第一次對內公告、30 分鐘內產出復原決策為訓練目標。
- 將結果附在 PR／事件系統，不附 secret 或顧客資料。
