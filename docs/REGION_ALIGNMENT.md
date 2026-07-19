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

- Preview deployment：`dpl_4wCYqFrnuvm9NsFTp65VzFMtrvwE`，狀態 `READY`。
- Commit：`4f537374d37fae836bd670bb7c1dea15904337b8`。
- Vercel Deployment API：`regions=["hnd1"]`。
- `vercel inspect`：Node.js Function build 顯示 `[hnd1]`。
- 量測入口 `x-vercel-id` PoP：`hkg1`；這是 CDN 入口，不等同 Function region。
- `/api/health`：200 JSON，`Cache-Control: no-store`，不是 Deployment Protection HTML。
- Preview 保護以短效 Vercel OIDC trusted-source header 通過；量測輸出不保存 token。

| 指標 | Production baseline (`iad1`) | P0 Preview (`hnd1`) | 改善 |
| --- | ---: | ---: | ---: |
| `/api/health` cold-like TTFB | 1038.5 ms | 179.9 ms | 82.7% |
| `/api/health` warm total P75 | 1006.6 ms | 115.3 ms | 88.5% |
| `/` warm total P75 | 255.4 ms | 111.9 ms | 56.2% |
| `/login` warm total P75 | 264.8 ms | 100.6 ms | 62.0% |
| `/onboarding` warm total P75 | 253.0 ms | 103.8 ms | 59.0% |

完整方法與樣本在 `performance-results/p0.json` 與 `docs/performance/P0_MEASUREMENT.md`。Baseline 是既有 Production，P0 是受保護 Preview；兩者使用相同台灣端腳本與 run count，但部署環境不同，因此頁面數值只作方向性比較。`/api/health` 的單一 DB round trip 與 Deployment API region 是區域改善的主要因果證據。

Vercel 外部回應未保留應用設定的 `Server-Timing`，但 Runtime Logs 中 15 筆 health `request_completed` 顯示 `totalMs` 平均 13.7 ms、`dbMs` 平均 13.2 ms，證明應用內計時已生效；外部 TTFB 另包含 CDN 與網路成本。

## 回復方式

若 `hnd1` 發生平台相容或可用性問題：

1. 將 `vercel.json` 的 `regions` 回復為上一個已驗證設定。
2. 建立 Preview 並執行 health、login、QR read-only smoke。
3. 回復 Production alias 至上一個 READY deployment。
4. 不變更 Supabase region、RLS、連線 Secret 或 public order security controls。
