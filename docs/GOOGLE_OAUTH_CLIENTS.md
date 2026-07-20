# Google OAuth Clients

## 環境隔離

| 環境 | Google Client | JavaScript Origin | Supabase callback |
| --- | --- | --- | --- |
| Production | `StallOrder Production Web` | `https://app.qidaigo.com` | `https://eyuctbnlvnbnivwasvqr.supabase.co/auth/v1/callback` |
| Staging | `StallOrder Staging Web` | `https://staging.qidaigo.com` | `https://daeqwtpaxcebmtwxqdkj.supabase.co/auth/v1/callback` |
| Local | `StallOrder Local Development` | `http://localhost:3000`、`http://127.0.0.1:3000` | `http://127.0.0.1:54321/auth/v1/callback` |

Client IDs 與 Secrets 均不記錄在 Git。三個環境必須使用不同 Client ID 與 Secret。

三個 Client 已於 2026-07-20 建立並核對為彼此不同；本文件只保存非敏感的名稱、Origin 與 callback。

## Supabase Auth URL

Production：

- Site URL：`https://app.qidaigo.com`
- Allow list：`https://app.qidaigo.com/auth/callback`
- Allow list：`https://app.qidaigo.com/invite/claim`

Staging：

- Site URL：`https://staging.qidaigo.com`
- Allow list：`https://staging.qidaigo.com/auth/callback`
- Allow list：`https://staging.qidaigo.com/invite/claim`

實際邀請頁使用 `/invite/[token]`，OAuth 一律先回 `/auth/callback`，再由伺服器驗證相對 `next` 後導向；邀請 token 不會加入 Google Client redirect URI。

## Feature Flag

`NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED=true` 只控制登入按鈕與 OAuth 起始路由是否啟用，不是 Secret。Server 仍要求 Supabase URL 與 publishable key 完整，callback 仍執行 PKCE、Email 驗證及 RBAC。
