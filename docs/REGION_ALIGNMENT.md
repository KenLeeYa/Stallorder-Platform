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

Preview 部署後必須由 Vercel Deployment API 確認 `regions` 等於 `hnd1`，不能只依瀏覽器 header 推測。量測同一組 read-only routes，並將結果填入 `docs/PERFORMANCE_RESULTS.md`。

## 回復方式

若 `hnd1` 發生平台相容性問題，回復此變更 commit 或移除 `regions` 後重新部署；資料庫、DNS 與 secret 不需變更。回復前後都要保留 deployment ID 與 read-only smoke 結果。
