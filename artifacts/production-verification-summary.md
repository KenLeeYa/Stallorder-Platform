# Production Verification Summary

執行日期：2026-07-16（Asia/Taipei）

分支：`deployment/production-qidaigo`

範圍：目前 working tree（含既有 P0–P2 功能與 qidaigo.com 部署準備）

## 本機結果

| Command／check | Result | Failure reason | Corrective action |
| --- | --- | --- | --- |
| `npm ci`（第一次） | FAIL | 舊的本專案 Next.js／Edge QA 程序鎖住 Prisma Windows DLL | 只停止 StallOrder 的舊程序後重跑 |
| `npm ci`（第二次與最終輪） | PASS | 無 | 468 packages；npm audit 0 vulnerabilities |
| `npm run prisma:generate` | PASS | npm 11 本機 policy 未自動執行 Prisma postinstall | CI 與驗證流程明確執行 generate |
| `npm run prisma:validate` | PASS | 無 | Schema valid；Prisma 7 config migration 是非阻擋警告 |
| `npm run lint` | PASS | 無 | 無 |
| `npm run typecheck` | PASS | 無 | 無 |
| `npm test` | PASS | 無 | 30 files／110 tests |
| `npx supabase db reset` | PASS | 無 | 26 migrations 由空資料庫依序套用；demo seed 僅在 Development |
| `npm run db:test` | PASS | 無 | 12 files／224 assertions |
| `npx supabase db lint --local --level warning --fail-on warning` | PASS | 無 | 0 schema warnings/errors |
| `npm run production:check` | PASS | 無 | 343 files／26 migrations；一個 data-copy-then-drop migration 已審查 |
| Workflow YAML parse | PASS | 無 | 2 workflows valid |
| `npm run build` | PASS | 無 | Next.js 16.2.10 production build completed |
| `npm audit --audit-level=moderate` | PASS | 無 | 0 vulnerabilities |
| Local production smoke | PASS | 無 | 19 checks passed；正式 domain redirect 與 test QR widget 依設計待遠端驗證 |
| `npm run test:e2e` | PASS | 無 | 18／18 Playwright tests；OAuth mock、Next.js、Edge Functions 全流程 |

## 已驗證安全／相依性項目

- `.env`、secret/service key、database credential、Turnstile secret、OAuth secret、Vercel token 未納入版本控制。
- Production scripts 不執行 demo seed、`db reset` 或 `--include-seed`。
- 公開 QR 下單仍透過三個受信任 Edge Functions；anonymous database write 與跨租戶／跨攤位測試通過。
- Vercel client IP 僅新增明確 `x-forwarded-for` 白名單，且只接受單一合法 IP；逗號鏈與任意 header 仍拒絕。
- Migration filename/order、RLS test presence 與 destructive SQL guardrail 通過。

## 尚待遠端驗證

以下不是本機失敗，而是需要費用確認、正式 secrets 或 DNS 人工作業：

- 建立 `stallorder-staging`／`stallorder-production`。
- Remote migration history／dry-run／apply、RLS、Security Advisor、Performance Advisor。
- Staging／Production Edge secrets 與 Function deployment。
- Vercel project、Preview／Production variables 與 deployments。
- `app.qidaigo.com`、root／www domain、GoDaddy DNS、HTTPS。
- Production Turnstile widget、專用 test QR 與完整 Production smoke test。
- Backup／restore rehearsal、monitoring 與 GitHub protected Environment approval。

所有遠端未完成項目維持 Go-Live blocker；不得接真實訂單。
