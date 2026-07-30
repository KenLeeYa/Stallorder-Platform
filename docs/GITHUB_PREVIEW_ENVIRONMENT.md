# GitHub Preview Environment 自動化

## 目的

每個 Pull Request 使用同一組配對資源：

1. GitHub `Preview` Environment。
2. Data-less Supabase Preview Branch，例如 `pr-53-oauth-delivery`。
3. 只連到該 Supabase Branch 的 Vercel Preview。
4. 僅使用合成資料的 OAuth、外送、訂單、KDS 與回寫 smoke。

工作流程不會更新 Production，也不會對正式攤位送出測試訂單。

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
powershell -ExecutionPolicy Bypass `
  -File .\scripts\configure-github-preview-environment.ps1 `
  -RerunRunId 30487579394
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
