# Secret Sync Automation

本流程讓 Codex 在需要 secret 時從本機安全來源讀取，直接更新 Vercel Environment Variables 與 Supabase Vault。不得把 secret 寫入 Git、Markdown、聊天回覆、terminal log 或 issue。

## 本機檔案

本機 bundle 放在 `.secrets/stallorder.local.json`，此目錄已被 `.gitignore` 排除。

範例結構如下，請只在本機建立實際檔案：

```json
{
  "secrets": [
    {
      "name": "CRON_API_SECRET",
      "generate": true,
      "bytes": 32
    }
  ],
  "vercel": {
    "team": "ada76145",
    "items": [
      {
        "name": "CRON_API_SECRET",
        "secret": "CRON_API_SECRET",
        "environments": ["production", "preview"]
      }
    ]
  },
  "supabaseVault": {
    "databaseUrlEnv": "DIRECT_URL",
    "items": [
      {
        "name": "cron_api_secret",
        "secret": "CRON_API_SECRET",
        "description": "StallOrder process-orders cron API bearer secret"
      }
    ]
  }
}
```

## 執行方式

先 dry-run，只確認名稱與目標：

```powershell
npm run secrets:sync
```

確認後才實際更新：

```powershell
$env:DIRECT_URL='<Supabase direct/session connection string from local secret source>'
npm run secrets:sync:apply
```

## 安全規則

- `secrets[].generate=true` 會產生至少 32 bytes 的高熵值並寫回本機 bundle。
- 執行輸出只顯示 secret 名稱，不顯示值。
- Vercel 使用 `vercel env rm` 後 `vercel env add` 更新指定環境。
- Supabase Vault 使用 Prisma direct connection 執行 `vault.create_secret`，secret 只經由 stdin 傳入，不放在命令列參數。
- 如果 secret 曾進入 Git、聊天、截圖或 log，必須先 rotate，再重新同步。
