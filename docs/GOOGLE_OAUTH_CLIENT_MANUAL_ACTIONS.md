# Google OAuth Client 人工設定與復原參考

> 目前狀態：三個 Web Application Client 已於 2026-07-20 由已登入且具權限的操作者完成建立與核對。本頁保留作為日後輪替或災難復原參考；重新建立或輪替時屬 `USER ACTION REQUIRED`。不要將 Client Secret 貼到 Issue、PR、聊天或文件。

入口：Google Cloud Console → Google Auth Platform → Clients → Create Client → Web application。

## Production

- Name：`StallOrder Production Web`
- Authorized JavaScript Origins：`https://app.qidaigo.com`
- Authorized Redirect URIs：`https://eyuctbnlvnbnivwasvqr.supabase.co/auth/v1/callback`
- 不得加入 localhost、Staging 網域或 wildcard。

## Staging

- Name：`StallOrder Staging Web`
- Authorized JavaScript Origins：`https://staging.qidaigo.com`
- Authorized Redirect URIs：`https://daeqwtpaxcebmtwxqdkj.supabase.co/auth/v1/callback`
- 不得共用 Production Client ID 或 Client Secret。

## Local

- Name：`StallOrder Local Development`
- Authorized JavaScript Origins：
  - `http://localhost:3000`
  - `http://127.0.0.1:3000`
- Authorized Redirect URIs：`http://127.0.0.1:54321/auth/v1/callback`
- 不得共用任何遠端環境憑證。

## 安全交付

Client 建立後，將 ID 與 Secret 直接輸入相對應 Supabase Dashboard，或在本機執行安全輸入腳本：

```powershell
.\scripts\configure-google-oauth.ps1 -Target staging -Apply
```

腳本預設為 dry run；Secret 使用隱藏輸入，不會回顯。Production 套用前必須完成 Staging 測試計畫。
