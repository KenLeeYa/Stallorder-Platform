# Google OAuth 自動化操作手冊

## 自動化邊界

Repository 已自動化：

- 本機 Supabase Google Provider 設定格式
- Supabase Management API 的 Staging/Production provider 更新
- Site URL 與 redirect allow list 合併
- Google 登入 feature flag
- PKCE callback、可信任角色導向、session cookie 與 audit log
- OAuth 設定與 Secret 洩漏檢查
- 單元測試及受控 E2E OAuth mock

`gcloud iam oauth-clients` 無法安全替代 Google Auth Platform 的消費者 Web Client。本次已透過已驗證的 Google Cloud Console 工作階段建立三個 Web Client；Branding 法務確認、Audience 發布及 Google 可能要求的驗證仍需人工授權。

## 執行狀態（2026-07-20）

- Google Cloud CLI `576.0.0` 已安裝並完成互動式授權；目前使用 `stallorder-identity` 專案。
- Production、Staging、Local Web Client 已分環境建立，Origin 與 callback 均已逐一核對，未在 Repository 記錄 Client ID 或 Secret。
- Production 與 Staging Supabase Google Provider 已啟用；Site URL 與 redirect allow list 已限制於各自環境。
- Local Provider 已透過被 Git 忽略的 `.env` 設定，且本機 OAuth 起始端點可正確導向 Google。
- Vercel Production 與 `staging` Preview 已設定 `NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED=true`；需部署包含本次程式碼的版本後，登入介面才會套用新版行為。
- Staging 已由指定測試帳號完成真實 Google 登入、平台後台存取、登出及登出後受保護路由阻擋驗證。
- Production 僅完成 Provider 起始導向檢查，未執行真實登入，避免建立正式環境測試資料。
- Google Audience 維持 `Testing`；正式發布仍屬 `USER ACTION REQUIRED`。

## Dry Run

PowerShell：

```powershell
.\scripts\configure-google-oauth.ps1 -Target staging
.\scripts\configure-google-oauth.ps1 -Target production
.\scripts\configure-google-oauth.ps1 -Target local
```

Bash：

```bash
./scripts/configure-google-oauth.sh staging
```

## 套用

遠端設定需 `SUPABASE_ACCESS_TOKEN`，可先放入目前 process 的環境變數，或由腳本以安全輸入提示取得。Client Secret 不得出現在命令參數。

```powershell
.\scripts\configure-google-oauth.ps1 -Target staging -Apply
.\scripts\configure-google-oauth.ps1 -Target production -Apply
```

本機設定寫入被 Git 忽略的根目錄 `.env`：

```powershell
.\scripts\configure-google-oauth.ps1 -Target local -Apply
```

## 回復

遠端 rollback 只停用 Google Provider，保留既有 Secret 供受控復原；本機 rollback 移除三個 Google OAuth 設定鍵。

```powershell
.\scripts\configure-google-oauth.ps1 -Target staging -Rollback
.\scripts\configure-google-oauth.ps1 -Target production -Rollback
.\scripts\configure-google-oauth.ps1 -Target local -Rollback
```

Google Client 本身需在 Google Auth Platform 手動停用或刪除。執行前先記錄非敏感設定，執行後只回報 enabled、Client ID 最後六碼、Secret 是否存在、Site URL 與 redirect URLs。

## 驗證

```powershell
npm run oauth:verify
npm run typecheck
npm test
npm run test:e2e
```

`oauth:verify` 不執行真實 Google 登入，也不讀取或輸出 Secret。
