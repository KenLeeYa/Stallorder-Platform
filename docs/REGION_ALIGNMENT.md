# Vercel 與 Supabase 區域對齊

## 修改前證據

- Production deployment：`dpl_ALPBiwEDtjhPAxYi1zKD5qQkVEJW`。
- Vercel Deployment API：`regions=["iad1"]`。
- Production commit：`d62dd89f6760285f34ce41306263c16256459183`。
- Supabase Production：Tokyo `ap-northeast-1`。
- 主要使用者：台灣。
- `/api/health` warm P75：`1006.6 ms`；單一 `SELECT 1` 已超過 1 秒。

這組證據支持 Vercel Washington D.C. 到 Supabase Tokyo 的跨區 round trip 是 P0 瓶頸；不是以地理位置猜測。

## P0 設定

`vercel.json` 保留 schema 並只指定：

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["hnd1"]
}
```

PostgreSQL 是單一 Tokyo region，因此本階段不設定多個 Function regions。

## 部署後驗證

P0 Preview 必須同時符合：

1. Deployment `READY`。
2. Vercel Deployment API 的 `regions` 僅有 `hnd1`。
3. `/api/health` 為 200 JSON，不被 Protection 頁面誤判。
4. `x-vercel-id` 入口 PoP 與 Deployment API Function region 分開記錄。
5. 使用相同 script／run count 重新量測 cold-like 與 warm P75。

部署 ID、commit 與 after latency 會在 P0 Preview 完成後補入，不預填猜測值。

## 回復方式

若 `hnd1` 發生平台相容或可用性問題：

1. 將 `vercel.json` 的 `regions` 回復為上一個已驗證設定。
2. 建立 Preview 並執行 health、login、QR read-only smoke。
3. 回復 Production alias 至上一個 READY deployment。
4. 不變更 Supabase region、RLS、連線 Secret 或 public order security controls。
