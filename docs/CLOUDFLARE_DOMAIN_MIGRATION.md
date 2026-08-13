# Cloudflare Domain Migration Automation

> **歷史遷移文件：不要直接執行 Apply。** 目前 `qidaigo.com` 是品牌公開網站、
> `www.qidaigo.com` 永久導向 root、`app.qidaigo.com` 才是應用。下列 DNS 值與
> automation 是舊 Vercel 單專案架構的遷移紀錄；任何變更前必須重新從目前的
> 應用與公開網站專案匯出 Domain 設定並另做 dry-run 稽核。

歷史目標架構：

GoDaddy Registrar -> Cloudflare Authoritative DNS -> Vercel Next.js Production -> Supabase Backend

Application hostname: `app.qidaigo.com`

Current public canonical hostname: `qidaigo.com`

Current redirect hostname: `www.qidaigo.com` -> `https://qidaigo.com/`

## Vercel Supplied DNS Records

這些值來自 Vercel Domain UI，不是推測值。

| Hostname | Type | Name | Value |
| --- | --- | --- | --- |
| `app.qidaigo.com` | `CNAME` | `app` | `6b2c35820840b357.vercel-dns-017.com` |
| `www.qidaigo.com` | `CNAME` | `www` | `6b2c35820840b357.vercel-dns-017.com` |
| `qidaigo.com` | `A` | `@` | `216.198.79.1` |

## 本機環境變數

只需在本機設定，不要提交到 Git，也不要貼到聊天。

```powershell
[Environment]::SetEnvironmentVariable("CLOUDFLARE_API_TOKEN", "<cloudflare-api-token>", "User")
[Environment]::SetEnvironmentVariable("CLOUDFLARE_ACCOUNT_ID", "<cloudflare-account-id>", "User")
```

如果帳號中有多個同名 zone，另外設定：

```powershell
[Environment]::SetEnvironmentVariable("CLOUDFLARE_ZONE_ID", "<qidaigo-zone-id>", "User")
```

重開 Codex 或 terminal 後確認：

```powershell
$names = @("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_ZONE_ID")
$names | ForEach-Object {
  [pscustomobject]@{ Name = $_; Present = [bool][Environment]::GetEnvironmentVariable($_, "User") }
} | Format-Table -AutoSize
```

## Dry Run

```powershell
npm run domain:migration
```

此指令會：

- 讀取 Cloudflare `qidaigo.com` zone。
- 檢查 `app`、`www`、`@` 是否有衝突或重複 DNS records。
- 產生 `artifacts/domain-migration-plan.json`。
- 不修改任何 DNS。

遇到下列情況會停止：

- 找不到 Cloudflare zone。
- 同名 zone 超過一個且未設定 `CLOUDFLARE_ZONE_ID`。
- `app` 或 `www` 已有 A / AAAA / CNAME 衝突。
- `@` 已有衝突 A / AAAA / CNAME。
- 同一 name/type 有重複 records。

## Apply

此歷史 Apply 指令不得用於目前架構；完成新的 domain ownership 與 DNS records
稽核、更新 automation 並產生新 plan 前，請勿執行：

```powershell
npm run domain:migration:apply
```

此指令只會建立或更新三筆 Vercel 要求的 DNS records，且強制 `DNS only`：

- `CNAME app -> 6b2c35820840b357.vercel-dns-017.com`
- `CNAME www -> 6b2c35820840b357.vercel-dns-017.com`
- `A @ -> 216.198.79.1`

不會刪除或修改 MX、SPF、DKIM、DMARC、email bounce、mail verification 或 ownership records。

## 需要你手動處理

1. 在 Cloudflare 新增 `qidaigo.com` site。
2. 確認 Cloudflare 掃描到既有 Email / ownership records，尤其 MX、SPF、DKIM、DMARC。
3. 執行 dry-run 並確認沒有 blocking conflicts。
4. 執行 apply 後，到 GoDaddy 將 nameservers 改成 Cloudflare 指派的兩組。
5. 等 Cloudflare zone 變成 Active。
6. 回 Vercel Domain 頁面點 Verify / Refresh。
7. 確認 Vercel 顯示 domain verified 與 HTTPS certificate active。

## GoDaddy Nameserver 自動化

> 此段同屬歷史遷移流程。現行 nameserver 不得因本文件直接變更；必須先完成
> 目前 domain ownership、DNS records 與回復方案的獨立稽核及核准。

若已建立 GoDaddy Domains v3 Personal Access Token，設定：

```powershell
[Environment]::SetEnvironmentVariable("GODADDY_PAT", "<godaddy-personal-access-token>", "User")
```

重開 Codex 或 terminal 後先 dry-run：

```powershell
npm run registrar:nameservers
```

此指令會：

- 讀取 Cloudflare 指派的 nameservers。
- 確認 Cloudflare DNS 已有 Vercel 要求的 `app`、`www`、`@` records，且都是 DNS only。
- 讀取 GoDaddy 目前 nameservers。
- 產生 `artifacts/godaddy-nameserver-plan.json`，包含 rollback nameservers。
- 不修改 GoDaddy。

確認後才執行：

```powershell
npm run registrar:nameservers:apply
```

此指令會呼叫 GoDaddy Domains v3：

- `GET /v3/domains/domain-names/qidaigo.com`
- `PUT /v3/domains/domain-names/qidaigo.com/nameservers`
- `GET /v3/domains/operations/{operationId}`

GoDaddy nameserver 更新會使用 `Idempotency-Key`，送出後只輪詢 operation，不會重複提交。

## 驗證

```powershell
Resolve-DnsName app.qidaigo.com
Resolve-DnsName qidaigo.com
Resolve-DnsName www.qidaigo.com

curl.exe -I https://app.qidaigo.com/api/health
curl.exe -I https://qidaigo.com
curl.exe -I https://www.qidaigo.com
```

正式 smoke：

```powershell
$env:PRODUCTION_BASE_URL='https://app.qidaigo.com'
$env:ROOT_DOMAIN_URL='https://qidaigo.com'
$env:WWW_DOMAIN_URL='https://www.qidaigo.com'
npm run production:smoke
```

## Rollback

`artifacts/domain-migration-plan.json` 會為每個 write step 產生 rollback 說明：

- CREATE rollback：刪除新建立 record。
- UPDATE rollback：還原原本 content 與 `proxied` 狀態。

GoDaddy nameserver rollback 需手動改回原 nameservers。請在切換前截圖或記錄 GoDaddy 原 nameservers。
