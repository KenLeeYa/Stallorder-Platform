# GitHub Preview Environment 自動化

## 目的

每個 Pull Request 使用同一組配對資源：

1. GitHub `Preview` Environment。
2. Data-less Supabase Preview Branch，例如 `pr-53-oauth-delivery`。
3. 只連到該 Supabase Branch 的 Vercel Preview。
4. 僅使用合成資料的 OAuth、外送、訂單、KDS 與回寫 smoke。

工作流程不會更新 Production，也不會對正式攤位送出測試訂單。

## 隔離的真實 LINE Login 驗收

使用者明確要求真實 LINE 登入時，允許在同一套 data-less PR 配對資源完成有限驗收；一般 smoke 仍使用合成資料。`staging` 僅為來源／檢查分支，沒有常駐 Staging 測試網站；DR 是受保護的待命環境，不作測試資料庫。

1. GitHub `Preview` Environment 暫存 `LINE_PREVIEW_CHANNEL_SECRET`，以及 `LINE_LIVE_PREVIEW_BRANCH`、`LINE_PREVIEW_CHANNEL_ID` Variables。只在 PR branch 完全吻合時選用 TEST Channel；不可寫入 Vercel 共用／Production 環境變數。
2. Workflow 只把 `OAUTH_LINE_PREVIEW_LIVE=true`、`LINE_CHANNEL_ID`、`LINE_CHANNEL_SECRET` 注入此次配對 Vercel deployment 的 build/runtime。核對實際 project、非 Production target、Git ref/SHA、run/resource metadata 與環境變數名稱；普通 Git 自動 Preview 不是驗收網址。
3. 在 `VERCEL_ENV=preview` 且明確啟用時，只有 LINE 使用 LIVE adapter；Google synthetic smoke 保持 Mock。Callback 使用該 deployment 的唯一 HTTPS hostname；拒絕殘留靜態 `LINE_REDIRECT_URI`，Production 不接受這項隱式 callback 特例。LIVE LINE 的 mock authorize 入口必須回 404。
4. reviewed migrations、DB tests/lint、build、配對 readback、synthetic smoke 與清理成功後，才執行 `supabase/fixtures/line_live_preview.sql`。只在非 parent 的 Preview Branch 啟用 OAuth foundation 與 LINE；旗標存在檢查和覆寫必須放在同一個 `DO` SQL statement，符合 `supabase db query --file` prepared-statement 執行器且保持原子性。
5. LINE TEST Channel 暫時新增唯一 deployment Callback，保留原本設定。瀏覽器完成授權／Callback／session，資料庫只讀取 aggregate 作證，不記錄姓名、email、provider subject、token、cookie 或 Secret。需要手機驗證時交由帳號本人完成。
6. 驗收結束移除本次 Callback、GitHub LINE Secret／兩個 Variables，以及所有帶該 PR metadata 的測試 deployment 和專屬 Supabase Branch；逐一 read-back。只刪 Secret 不會清掉已部署的 runtime Secret。若等待本人手機驗證，列明暫留資源與原因，不宣稱已清理。

Production／DR 的 Channel、Callback、部署、aliases、backend 與 flags 不隨這項驗收更動；前後核對正式 `/login`、`/staff/login`、health 與實際 deployment。驗收不授權合併或 Production 啟用。

回歸案例：`QA-AUTH-LINE-01`／`QA-AUTH-LINE-02`、`scripts/lib/production-workflow-contract.test.mjs`。PR #359 的第一輪 `34752843405` 在最後旗標 fixture 因多指令 prepared statement 失敗；此修正不略過任何前置 Gate，後續需以新 commit 重跑，不能把先前的 synthetic 成功稱為真實登入成功。

## 一次性人工授權

Vercel CLI 的本機 App 授權可部署，但 Vercel 禁止它建立另一枚長效 Token。
因此只有以下步驟需要人工完成：

1. 開啟 Vercel Account Settings 的 Tokens 頁面。
2. 建立名稱為 `stallorder-github-preview` 的 Token。
3. Scope 選擇 `ada76145-8663s-projects`。
4. 設定合理到期日，建議 90 天。
5. 不要把 Token 貼到聊天、Issue、PR、檔案或命令列參數。

Vercel 官方 Tokens 頁面：

```text
https://vercel.com/account/tokens
```

## 一鍵設定

在 Repository 根目錄執行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\configure-github-preview-environment.ps1
```

腳本會以隱藏輸入方式接收 Vercel Token，並自動完成：

- 驗證 GitHub CLI 與 Vercel 專案存取權。
- 建立或沿用 GitHub `Preview` Environment。
- 從 Vercel API 取得實際 `VERCEL_ORG_ID` 與 `VERCEL_PROJECT_ID`。
- 寫入 GitHub Environment Variables。
- 寫入 `VERCEL_TOKEN` Environment Secret。
- 沿用既有 `Supabase-cron-preview` Automation Bypass，寫入
  `VERCEL_AUTOMATION_BYPASS_SECRET`。

腳本不會輸出任何 Secret 值。

若要設定後立即重跑既有 Actions run：

```powershell
$runId = gh run list `
  --repo KenLeeYa/Stallorder-Platform `
  --workflow "Ephemeral Preview Validation" `
  --branch feature/delivery-platform-integration-foundation `
  --limit 1 `
  --json databaseId |
  ConvertFrom-Json |
  Select-Object -First 1 -ExpandProperty databaseId

powershell -ExecutionPolicy Bypass `
  -File .\scripts\configure-github-preview-environment.ps1 `
  -RerunRunId $runId
```

## GitHub Preview Environment

必要 Secrets：

- `SUPABASE_ACCESS_TOKEN`
- `VERCEL_TOKEN`
- `VERCEL_AUTOMATION_BYPASS_SECRET`

必要 Variables：

- `SUPABASE_PARENT_PROJECT_REF`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

驗證名稱，不讀取 Secret 值：

```powershell
gh secret list --env Preview --repo KenLeeYa/Stallorder-Platform
gh variable list --env Preview --repo KenLeeYa/Stallorder-Platform
```

## 自動生命週期

- PR opened、synchronize、reopened、ready_for_review：
  建立或沿用 `pr-<PR>-oauth-delivery`，套用 migration、fixture、DB tests、
  DB lint、Edge Functions、Vercel Preview 與 synthetic smoke。
- 同一 PR 重跑：
  沿用同一 Supabase Preview Branch。
- PR closed：
  移除該 PR 的 Vercel Preview 與 Supabase Preview Branch。

## 回復方式

若要停用 GitHub Preview 部署：

```powershell
gh secret delete VERCEL_TOKEN `
  --env Preview `
  --repo KenLeeYa/Stallorder-Platform
```

若要完整移除這個腳本寫入的設定：

```powershell
gh secret delete VERCEL_AUTOMATION_BYPASS_SECRET `
  --env Preview `
  --repo KenLeeYa/Stallorder-Platform
gh variable delete VERCEL_ORG_ID `
  --env Preview `
  --repo KenLeeYa/Stallorder-Platform
gh variable delete VERCEL_PROJECT_ID `
  --env Preview `
  --repo KenLeeYa/Stallorder-Platform
```

再到 Vercel Tokens 頁面撤銷 `stallorder-github-preview`。保留 Supabase
設定時，工作流程仍會執行資料庫與建置驗證，但會跳過 Vercel cloud smoke。
