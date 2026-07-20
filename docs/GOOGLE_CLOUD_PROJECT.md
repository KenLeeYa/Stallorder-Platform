# Google Cloud Project

## 選用專案

| 欄位 | 值 |
| --- | --- |
| Project ID | `stallorder-identity` |
| Display name | `StallOrder Identity` |
| 已驗證操作者 | `ada76145@gmail.com` |
| Billing | 本工作未新增、綁定或修改 |

此專案專門承載 StallOrder 的 Google Auth Platform 設定。OAuth Client Secret 不記錄於本文件、Git、CI log 或公開環境變數。

## 工具相容性結論

已檢查目前 `gcloud iam oauth-clients create` 與 `gcloud iam oauth-clients credentials create` 說明。這組 IAM API 指令未提供 Google Sign-In Web Application Client 所需的 Authorized JavaScript Origins，也無法證明產物等同於 Google Auth Platform 的消費者 Web Client。

因此本專案禁止用該指令替代 Google Auth Platform Web Application Client。Client 建立與 Branding/Audience 發布需在 Google Auth Platform 完成，其餘 Supabase、Local 與程式設定可使用本 Repository 的自動化流程。
