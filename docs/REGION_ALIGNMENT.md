# Vercel 與 Supabase 區域對齊

## 修改前證據

調查基準版本 `d62dd89f6760285f34ce41306263c16256459183`：

| 項目 | 已驗證值 | 證據來源 |
| --- | --- | --- |
| Vercel project | `stallorder-platform` | Vercel authenticated project API |
| Production deployment | `dpl_ALPBiwEDtjhPAxYi1zKD5qQkVEJW` | Vercel deployment API |
| Function region | `iad1` | Deployment `regions` 欄位 |
| Supabase production region | `ap-northeast-1` | Supabase Management API |
| 主要使用者 | 台灣 | 產品部署需求 |

`x-vercel-id` 量到的 `hkg1` 是 Vercel Edge ingress PoP，不是 Function region。正式站 `/api/health` 修改前 cold 1,045.4 ms、warm P75 1,006.6 ms；同時間 `pg_stat_statements` 顯示大多數應用 SQL 執行低於 5 ms，因此 IAD 到東京的跨區連線與多次往返是已驗證的主要高延遲來源。

## 修改

`vercel.json` 保留 schema 並指定單一 Tokyo region：

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["hnd1"]
}
```

資料庫仍為東京單區，故本階段不配置多個 Function region。

## 部署驗證

驗證用 Preview deployment `dpl_EczGfwK49GD2RYjeQgbjxebdxYvj`（commit `89202ac46ac92e0a4474930f5a11cd30bf929d2f`）已由 Vercel Deployment API 確認 `regions` 僅有 `hnd1`。`/api/health` response 的 `x-vercel-id` 亦為 `hkg1::hnd1::*`，分別代表入口 Edge PoP 與 Function 執行區。

同一量測腳本的 health warm P75 從修改前 Production 1,006.6 ms 降至 Preview 126.3 ms，改善 87.5%。Runtime warm log 顯示實際 `dbMs` 約 15.5-25.5 ms，支持跨區往返是原始主要瓶頸，而不是 SQL 本身。

## 回復方式

若 `hnd1` 發生平台相容性問題，回復此變更 commit 或移除 `regions` 後重新部署；資料庫、DNS 與 secret 不需變更。回復前後都要保留 deployment ID 與 read-only smoke 結果。
