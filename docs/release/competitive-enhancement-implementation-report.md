# 系統強化實作報告

## A. Executive Summary

在獨立本機 worktree 依 Master Prompt 補上模組化競爭力基礎，保留既有訂單/KDS/付款核心。外部 Provider、顧客發送、Webhook 投遞與活動歸因皆維持 fail-closed。

## B. Current State vs Final State

- 原有：核心點餐、KDS、取餐、報表、RBAC、Feature flags、Outbox/Inbox 與多種整合 foundation。
- 新增：通路菜單/HQ、Growth schema、Supply Lite、Event Growth、Public API/Webhook 管理、Advanced Analytics、Setup Center、模組總覽。
- 尚未：真實 Provider Sandbox/Pilot/Production、活動雙路歸因、顧客發送與 Webhook egress。

## C. Changed Files

主要新增於 `src/server/{catalog-versions,growth,supply-lite,event-growth,developer-platform,analytics,integrations,competitive-enhancements}`、對應 merchant/API UI、Prisma schema、Supabase migrations、seed 與本文件集。完整清單以 `git diff --name-status` 為準。

## D. Database Migrations

七個 `2026082613...` 至 `2026082618...` 新增式 migrations；詳見 `04-data-migration-plan.md`。均已由乾淨本機資料庫重建驗證，Production 尚未建立或 Apply Plan。

## E. Security Review

新表採 organization scope、FORCE RLS、無 anon/authenticated grant、service_role backend guard；API mutation 有 RBAC/CSRF/validation/audit；Key hash-only；Webhook secret reference 與 SSRF validation。

## F. Test Results

- lint：通過。
- typecheck：最終檔案樹通過。
- Vitest：404 files 通過、2 skipped；2,474 tests 通過、9 skipped。
- Production build：最終檔案樹通過；產生 95 個 static page tasks，新增 routes 均列入產物。
- UI control audit：268 個 TSX files 通過。
- `npm audit --audit-level=moderate`：0 vulnerabilities。
- Production guardrails：1,850 tracked files、121 migrations 通過。
- Prisma validate/generate：最終檔案樹通過；63 個 pgTAP files／1,502 tests 與 Supabase warning-level lint 全數通過。
- Production-mode E2E：127 個唯一案例以隔離 IP 分批全數通過；響應式路由矩陣涵蓋 320、390、768、1440 px。
- 韌性 E2E：8/8 通過，涵蓋離線 Permit、QR 降級、Circuit B、並行工作階段及 SSE／Realtime 雙失效輪詢。
- 新 schema：29 張新增表皆 FORCE RLS、anon/authenticated grants=0、backend write guards=29。
- Runtime：127.0.0.1 與區網來源登入成功；8 個新增管理頁為 HTTP 200；Staff、Kitchen、Platform Admin 預設頁為 HTTP 200。
- 垂直流程：建立市集／推廣／費用、Supply 收貨、優惠草稿、一次性 API Key、v1 菜單讀取與 Key 撤銷均成功。

## G. Provider Readiness

沒有 Provider 被宣告 Production Ready。請見 `docs/integrations/provider-readiness-matrix.md`。

## H. Manual Setup

唯一清單：`docs/integrations/external-setup-checklist.md`。

## I. Known Limitations

- 活動 attribution capture OFF。
- 顧客行銷／發券 hard-lock。
- Outbound Webhook delivery OFF。
- Advanced Analytics 只使用穩定摘要與已驗證模組資料。
- 提交前只有本機證據；GitHub、Staging、DR 與 Production evidence 必須由本次來源 commit 的新鮮 Plan／Apply 產生。

## J. Rollout Recommendation

本機完整 Gate 與使用者驗收已完成；仍須從 Staging／DR 產生新鮮、不可變、綁定 commit/tree 的 Plan，且不得把本機結果替代遠端 Apply 與 smoke 證據。
