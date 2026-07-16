# GoDaddy DNS 設定

## USER ACTION REQUIRED

實際 DNS 變更需由使用者登入 GoDaddy：`Domain Portfolio` → `qidaigo.com` → `DNS` → `Manage DNS`。

Vercel 專案與三個 domain 尚未建立，因此目前沒有可驗證的專案專屬 DNS 值。下表不得以通用 Vercel 範例補值；Vercel 回傳後，先更新表格再執行 GoDaddy 變更。

| Type | Name | Value | TTL | Purpose | Vercel verification status |
| --- | --- | --- | --- | --- | --- |
| 等待 Vercel 回傳 | `app` | 尚未回傳，禁止猜值 | 依 Vercel／GoDaddy 實際要求 | `app.qidaigo.com` primary | 尚未加入 Vercel |
| 等待 Vercel 回傳 | `@` | 尚未回傳，禁止猜值 | 依 Vercel／GoDaddy 實際要求 | root redirect | 尚未加入 Vercel |
| 等待 Vercel 回傳 | `www` | 尚未回傳，禁止猜值 | 依 Vercel／GoDaddy 實際要求 | www redirect | 尚未加入 Vercel |
| 視 Vercel challenge | Vercel 回傳的 verification name | Vercel 回傳的 verification value | 依 Vercel 實際要求 | domain ownership | 尚未回傳 challenge |

## 變更前盤點

1. 匯出或截圖全部現有 DNS 記錄，記錄 Type、Name、Value、TTL。
2. 保留所有 MX、SPF、DKIM、DMARC 與不相關 verification TXT。
3. 檢查同名 `@`、`app`、`www` 是否有衝突 A／AAAA／CNAME；不要直接刪除，先確認用途。
4. 不改 nameserver，除非 Vercel 明確要求且另行核准。

## 取得確切要求

Vercel 加入 domain 後，對每個網域執行 Dashboard Inspect 或：

```powershell
npx vercel domains inspect app.qidaigo.com
npx vercel domains inspect qidaigo.com
npx vercel domains inspect www.qidaigo.com
```

將輸出的 required record 與 verification challenge 原樣填入上表，不記錄 Vercel token。

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

驗收：Vercel 顯示 verified、HTTPS certificate active、`app` 可載入、root／www 只 redirect 到 `https://app.qidaigo.com`、Turnstile allowed hostname 完全一致。HTTPS 尚未 active 前不得開放真實 QR 點餐。
