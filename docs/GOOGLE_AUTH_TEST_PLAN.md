# Google Auth 測試計畫

## 自動化測試

受控 OAuth provider mock 只驗證 StallOrder 的導向、PKCE callback、session 與 RBAC，不會自動輸入 Google 密碼，也不使用 Production 憑證。

必要案例：

- Google 登入按鈕顯示及避免重複點擊
- OAuth 起始與 PKCE code exchange
- callback 缺少 code 時安全失敗
- 外部 `next` 被拒絕
- 無 session 無法進入受保護頁
- 無成員帳號只到 onboarding
- 現有密碼帳號仍可登入
- disabled profile 無法取得應用 session
- `user_metadata.role` 不影響授權

執行：

```powershell
npm run oauth:verify
npm test
npm run db:test
npm run test:e2e
```

## Staging 人工驗證

Google Audience 保持 Testing，使用已列入 Test users 的帳號：

1. 新 OAuth 使用者登入後進入商戶申請/待審流程。
2. 已綁定 Owner 登入正確進入 merchant workspace。
3. 多組織或多攤位帳號先進入選擇頁。
4. STAFF/KITCHEN 只能進入已指派攤位。
5. 邀請 Email 相符才可接受；錯誤 Email、過期、撤銷、重放皆拒絕。
6. 已停用 profile 登入顯示通用拒絕訊息。
7. 暫停組織無法進入營運頁。
8. logout 後 protected route 返回 login，瀏覽器不保留組織偏好或受保護快取。
9. 等待 session 到期並確認需重新登入。
10. 查看 Supabase Auth log 與 StallOrder audit log，不得出現 code/token/Secret。

### 目前結果（2026-07-20）

- 已完成：指定測試帳號真實 Google 登入、正確進入平台管理後台、登出，以及登出後拒絕受保護路由。
- 已完成：Production、Staging、Local OAuth 起始端點可導向 Google；未輸出 token 或 Secret。
- 自動化完成：外部 redirect 拒絕、無 membership 導向 onboarding、缺少 code 安全失敗、現有密碼登入與受保護路由阻擋。
- 尚待 Staging 人工驗證：新 Owner、員工邀請、錯誤 Email 邀請、停用使用者、多攤位選擇與 session 到期。
- 尚待部署後複核：Supabase Auth log 與 StallOrder audit log 的 Production-like Staging 記錄。

## Production Smoke

Production Provider 已完成設定，但尚未執行真實登入。Audience 正式發布後只使用明確核准的測試帳號，不建立測試商戶或訂單；驗證登入、角色導向、登出、HTTPS 與 callback。Production 資料測試需另行批准。
