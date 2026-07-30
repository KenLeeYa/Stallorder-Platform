# 外送平台 Ephemeral Preview 驗證

## 原則

- 不建立 Persistent Staging。
- 每個同 Repository PR 使用獨立 data-less Supabase Preview Branch。
- Vercel Preview 必須指向同一 Branch。
- 只使用 `supabase/seed.sql` 合成資料及
  `supabase/fixtures/delivery_mock_preview.sql`。
- 每次執行生成獨立 OAuth、Webhook、Cron、Audit、Session 與 Offline Secret。
- 不得使用 Production Auth User、Customer Data、Storage、Session、Provider Credential、Primary/DR URL。

## 自動流程

`.github/workflows/ephemeral-preview.yml`：

1. 驗證 Preview Supabase PAT 與 Parent Ref。
2. 建立/重用 `pr-<number>-oauth-delivery` data-less Branch。
3. 讀取並遮罩 Branch URL/Key。
4. 套用 Migration 與合成 Seed。
5. 執行 pgTAP、Database Lint、Prisma Generate、Typecheck、Build。
6. 套用 Preview-only OAuth/Delivery Flag Fixture。
7. 部署 Edge Functions。
8. 若 Vercel 授權完整，部署同一 Branch 的 Vercel Preview。
9. 執行 `npm run preview:delivery-smoke`。
10. PR 關閉或手動執行完成後清除資源。

## 合成 Smoke

Smoke 測試會驗證：

- Mock OIDC State/Nonce/PKCE 與 Callback Replay。
- Mock Webhook HMAC、Replay 與 Ledger。
- External Order 去重與 Canonical Order 建立。
- `WAITING_CONFIRMATION`、平台付款不進 Cash。
- Staff Confirm 產生 KDS Task。
- KDS `PREPARING`/`READY` 產生去重 Provider Job。

腳本硬拒絕 `app.qidaigo.com`、Production Vercel Alias 與未核准 Host。

## 缺少授權

Supabase Preview 授權缺少時工作流失敗；Vercel 授權缺少時只略過雲端 Browser/Smoke 並留下 Notice。不得以 Production 連線代替。所需設定見 `OAUTH_DELIVERY_USER_ACTIONS_REQUIRED.md`。
