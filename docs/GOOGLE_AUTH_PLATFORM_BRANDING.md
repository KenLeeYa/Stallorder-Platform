# Google Auth Platform Branding

> 目前狀態：Google Cloud Console 的 Branding、External Audience、Testing 狀態、Test user 與 Data Access 已於 2026-07-20 核對。法務內容審閱、Audience 正式發布及 Google 可能要求的驗證仍屬 `USER ACTION REQUIRED`，不得略過。

## Branding

- App name：`StallOrder｜攤點通`
- Support email：`ada76145@gmail.com`
- Application home page：`https://qidaigo.com`
- Privacy policy：`https://qidaigo.com/privacy`
- Terms of service：`https://qidaigo.com/terms`
- Authorized domain：`qidaigo.com`

`/privacy` 與 `/terms` 已提供繁體中文草案，但頁面標示 `LEGAL REVIEW REQUIRED`；正式發布前必須由適格人員確認聯絡方式、保存期間、責任限制及訂閱條款。

## Audience

- User type：External
- Staging 初期狀態：Testing
- Test user：`ada76145@gmail.com`
- Production：僅在 Staging 測試全部通過、法務 URL 可公開存取及網域驗證完成後，改為 In production。

## Data Access

只允許：

- `openid`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/userinfo.profile`

不得加入 Gmail、Drive、Calendar 或其他業務未需要的 scope。

## 發布前人工核對

1. 確認 `qidaigo.com` ownership。
2. 確認 App name、support email、首頁、隱私與條款 URL。
3. 確認三個 Web Client 完全分離且無 wildcard。
4. 完成 Google 要求的品牌或網域驗證。
5. Staging 測試通過後再發布 Audience；不得跳過 consent 或 verification。
