# 未來 Cloudflare 公開菜單快取提案

## 狀態與決策邊界

本文件是 P4 架構提案，不是部署紀錄。本階段沒有建立 Worker、KV、DNS record、
Cache Rule，也沒有將 `app.qidaigo.com`、`qidaigo.com` 或 `www.qidaigo.com`
切成 Cloudflare Proxy。現行正式路徑維持：

```text
使用者 -> Vercel CDN -> Vercel Function hnd1 -> Supabase Tokyo
```

P0 至 P3 已先完成區域對齊、原生 Data/CDN cache、查詢與前端最佳化。只有下列
量測門檻成立並另行核准，才進行 Worker PoC。

## 啟用門檻

至少連續四週蒐集 Production 指標，且同時符合：

1. 公開菜單 P75 或 LCP 仍連續超過既定預算，不是單次冷啟動或客戶網路離群值。
2. Vercel cache HIT 後仍有大量相同公開 GET 抵達 origin，且公開菜單讀取已形成可量化的 Function 或資料庫成本。
3. 至少 70% 公開菜單要求可由不含 cookie、Authorization、個人資料與 capability token 的相同 payload 回覆。
4. PoC 相較 Vercel-only 路徑，台灣端 P75 至少改善 25% 或 100 ms，cache HIT ratio 至少 90%，origin read 至少下降 70%。
5. 售罄、價格與停止接單的 purge/TTL 測試能維持產品核准的最大陳舊時間；公開下單仍會由 Edge Function 重讀官方狀態與價格。

任一門檻不成立，就不增加第二套 CDN。不得為了通過門檻而放寬 RLS、驗證或
訂單一致性。

## 獨立主機與路由

候選主機只有 `menu-api.qidaigo.com`。DNS 與 Worker custom domain 的實際 target
必須在實作當下由已驗證的 Cloudflare API 回應取得，不在文件中猜測。

允許：

```text
GET /menu/:stallSlug
GET /stall/:stallSlug
GET /images/*
```

禁止：

```text
/auth/*
/orders/*
/checkout/*
/staff/*
/merchant/*
/kitchen/*
/tracking/*
/api/health
```

Worker 必須拒絕非 `GET`/`HEAD`、未知 query 參數、`Authorization`、session cookie
或 origin 回覆 `Set-Cookie` 的 cache 寫入。QR raw token、order session、tracking
token、pickup code、顧客資料與租戶內部 ID 不得出現在 cache key、log 或 analytics。

## Payload 與快取策略

優先讓 Worker 代理一個專用、版本化且只含公開資料的 origin endpoint，不代理
Next.js HTML。建議分為：

| 類型 | 內容 | 初始策略 |
| --- | --- | --- |
| 穩定菜單 | 公開名稱、說明、分類、圖片、註記定義、排序 | 5 分鐘 fresh，10 分鐘 stale-while-revalidate |
| 易變狀態 | 價格、enabled、sold-out、ordering state | 5 至 15 秒 fresh，不允許長時間 stale-if-error |
| 圖片 | 內容雜湊或版本化 URL 的 WebP/AVIF | 長效 immutable；換圖產生新 URL |

Cache key 只可包含 normalized host、path、核准的 locale 與 payload schema version。
不得依任意 query、cookie、User-Agent 或原始 QR token 產生無界 key。Origin 回覆需含
明確 schema version、生成時間與不含機密的 stall public revision。

## 失效與一致性

商品、分類、價格、註記、供應、售罄、攤位公開資料或接單狀態變更時，既有
Next.js cache invalidation 先完成，再由 outbox/queue 事件觸發 Worker cache purge。
管理 API 不等待 Cloudflare 才提交資料庫交易；purge 失敗會留下可重試事件與營運
告警。若方案不支援所需的 tag purge，就採版本化 URL 或精確 URL purge，不假設
特定 Cloudflare 方案能力。

快取永遠不是訂單真實來源。`create-public-order` 必須繼續在 Supabase 端驗證：

- QR state、短效且一次性的 order session。
- Turnstile、rate limit、idempotency 與數量限制。
- 官方商品、價格、註記、供應、售罄與接單狀態。
- tenant/stall isolation、RLS、狀態機與 audit log。

## PoC 與遷移步驟

1. 在 Staging 建立只讀 public-menu origin contract 與契約測試，不建立 DNS。
2. 建立無 Production 資料的 Worker PoC，測試 cache key、cookie/auth bypass、TTL、purge 與故障模式。
3. 以臨時 hostname 做台灣桌面與 Android A/B 量測；比較 Vercel-only 與 Worker 路徑。
4. Security review 驗證禁止路由、資料最小化、log redaction、origin allowlist 與 response headers。
5. 另行核准後才新增 `menu-api.qidaigo.com`；只讓少量測試攤位 opt-in。
6. 逐批擴大前觀察 hit ratio、origin reads、錯誤率、purge lag、stale incidents 與成本。

不得把全站流量、登入、訂單或付款 API 導入此 Worker。

## 成本與營運取捨

新增成本包括 Worker request/CPU、可能的 KV/queue/log、purge API、監控與值班維護；
實際金額必須在實作當下依帳戶方案與 Cloudflare 最新價格確認。潛在收益是降低公開
菜單 origin read 與台灣讀取延遲。代價是多一個網路 hop、雙 CDN 可觀測性、兩套
失效邏輯、SSL/DNS/Firewall 設定與較複雜的事故定位。

若 Vercel native cache 已達預算，這些營運成本不合理，應維持現況。

## 監控與告警

Worker 只記錄去識別 route pattern、status、cache status、duration、origin duration、
payload bytes 與 safe request ID。不得記錄 request/response body 或原始識別值。
至少監控：

- HIT/MISS/BYPASS ratio、P50/P75/P95、origin read reduction。
- 5xx、origin timeout、purge failure、purge lag 與 stale state incident。
- Vercel origin、Supabase 與 Worker 的相同時間窗對照。
- Cloudflare 使用量與預算告警。

## 回滾

每個寫入步驟都要有反向操作：

1. 停止新的 opt-in，客戶端 feature flag 回到既有 Vercel public menu endpoint。
2. 將 Worker 回覆切成 bypass 或停用 route；不得改動訂單與驗證服務。
3. 移除或停用僅屬於 `menu-api.qidaigo.com` 的 DNS/custom domain。
4. 保留 `app.qidaigo.com` 與根網域既有 DNS、Vercel domain、郵件與驗證 records。
5. 清除 Worker cache/outbox，在 Vercel-only 路徑完成 smoke test 後結案。

回滾不需資料庫 schema 回復，也不得停用 RLS、Turnstile、rate limit 或 server-side
price validation。
