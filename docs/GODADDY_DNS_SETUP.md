# GoDaddy DNS 設定

## USER ACTION REQUIRED

實際 DNS 變更需由使用者登入 GoDaddy：`Domain Portfolio` → `qidaigo.com` → `DNS` → `Manage DNS`。

應用與品牌網站均已上線；下表保留為變更前的重新查核模板，不代表目前 DNS
狀態。任何變更前必須由目前的應用與公開網站專案重新取得專案專屬 DNS 值，
不得以舊值或通用 Vercel 範例補值。

| Type | Name | Value | TTL | Purpose | Vercel verification status |
| --- | --- | --- | --- | --- | --- |
| 重新查核 | `app` | 由應用專案重新取得 | 依管理平台／GoDaddy 實際要求 | `app.qidaigo.com` application | 待本次變更前確認 |
| 重新查核 | `@` | 由公開網站專案重新取得 | 依管理平台／GoDaddy 實際要求 | canonical public site | 待本次變更前確認 |
| 重新查核 | `www` | 由公開網站專案重新取得 | 依管理平台／GoDaddy 實際要求 | redirect 到 root | 待本次變更前確認 |
| 視 ownership challenge | 管理平台回傳的 verification name | 管理平台回傳的 verification value | 依實際要求 | domain ownership | 待本次變更前確認 |

## 變更前盤點

1. 匯出或截圖全部現有 DNS 記錄，記錄 Type、Name、Value、TTL。
2. 保留所有 MX、SPF、DKIM、DMARC 與不相關 verification TXT。
3. 檢查同名 `@`、`app`、`www` 是否有衝突 A／AAAA／CNAME；不要直接刪除，先確認用途。
4. 不改 nameserver，除非 Vercel 明確要求且另行核准。

## 取得確切要求

任何網域變更前，分別在目前負責該網域的 Dashboard Inspect；`app` 亦可使用：

```powershell
npx vercel domains inspect app.qidaigo.com
```

品牌網站的 root／www 請從其目前管理平台匯出設定。將 required record 與
verification challenge 原樣填入上表，不記錄 access token。

## GoDaddy 變更

只新增或修改 Vercel 明確要求的 A、CNAME 或 TXT。若 GoDaddy 自動補尾端網域，Name 僅填 Vercel 要求的 host label；儲存前再次比對完整 FQDN。

## 驗證

```powershell
Resolve-DnsName app.qidaigo.com
Resolve-DnsName qidaigo.com
Resolve-DnsName www.qidaigo.com
curl.exe -I https://app.qidaigo.com/api/health
curl.exe -I https://qidaigo.com
curl.exe -I https://www.qidaigo.com
```

驗收：應用與公開網站的管理平台都顯示 verified、HTTPS certificate active、`app` 可載入、root 回傳品牌網站、`www` 以永久 301／308 redirect 到 `https://qidaigo.com/`，且 Turnstile allowed hostname 完全一致。HTTPS 尚未 active 前不得開放真實 QR 點餐。
