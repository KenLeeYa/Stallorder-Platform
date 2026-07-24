# Pro Platform Settings

更新日期：2026-07-24

## 已套用的 Vercel Pro 設定

- 專案：`stallorder-platform`
- Production domain：`https://app.qidaigo.com`
- Function region：`hnd1`
- Speed Insights：已啟用
- Web Analytics：已啟用
- Git fork protection：已啟用
- Deployment Protection automation bypass：已存在，供受保護 Preview 自動化呼叫使用
- SSO Deployment Protection：目前套用於非自訂網域，避免阻擋正式自訂網域
- Skew Protection：已啟用，保留時間調整為 604800 秒（7 天）

Skew Protection 可降低部署後使用者手機仍停留在舊前端 bundle 時發生版本不一致的風險，適合 QR 點餐、店員手機操作與 Server Actions 並存的情境。

## Supabase Pro 建議設定

Supabase Auth 的洩漏密碼保護應在 Staging 與 Production 都啟用：

```json
{
  "password_hibp_enabled": true
}
```

此功能使用 HaveIBeenPwned Pwned Passwords 來拒絕已外洩密碼。官方文件標示此功能需要 Supabase Pro 或以上方案。

注意：這只保護 Supabase Auth 的密碼流程。StallOrder 目前仍有自建 `profiles.password_hash` 登入邏輯，該流程不會自動套用 Supabase Auth 的 HIBP 檢查；若未來要全面保護自建密碼登入，需要另做應用層 HIBP k-anonymity 檢查或將密碼登入遷移到 Supabase Auth。

## 自動化指令

檢查模式不會修改平台設定：

```powershell
npm run platform:pro:check
```

套用模式會：

- 啟用 Vercel Speed Insights
- 啟用 Vercel Web Analytics
- 啟用 Vercel Skew Protection 並設定保留 7 天
- 在有 Supabase PAT 與 project ref 時，啟用 Supabase Auth 洩漏密碼保護

```powershell
$env:SUPABASE_ACCESS_TOKEN = "<Supabase PAT>"
$env:SUPABASE_STAGING_PROJECT_REF = "<staging project ref>"
$env:SUPABASE_PRODUCTION_PROJECT_REF = "<production project ref>"
npm run platform:pro:apply
```

安全規則：

- 指令不會輸出 PAT、資料庫連線字串或 secret。
- project ref 只會以遮罩形式顯示。
- 缺少 Supabase PAT 時會略過 Supabase 設定，不會降級或覆蓋現有設定。
- 不會啟用會阻擋正式自訂網域的 Vercel SSO/password protection。

## 尚需人工確認

- Supabase Staging 與 Production 是否已在 Dashboard 確認為 Pro。
- 是否要將自建密碼登入加上應用層外洩密碼檢查。
- 是否要把 Supabase PAT 改成短效臨時 token，用完立即撤銷。
