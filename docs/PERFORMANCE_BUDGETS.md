# 效能預算

## P75 目標

| 指標 | 預算 |
| --- | ---: |
| Homepage TTFB | <= 300 ms |
| Login page TTFB | <= 500 ms |
| QR menu first visible content | <= 1.5 s |
| LCP | <= 2.5 s |
| Order session creation | <= 800 ms |
| Order submission | <= 1.5 s |
| Staff order list | <= 1 s |
| Merchant dashboard | <= 1.5 s |
| Health check | <= 300 ms |

`scripts/measure-production-performance.mjs` 會對可量測 HTTP route 產生 warning，但目前不因 Internet latency 直接使 CI 失敗。第一筆 `Cache-Control: no-cache` 是 cold-like，不宣稱一定為真正 Function cold start。

## Deterministic budgets

可在 CI 穩定阻擋的項目：

- `npm run build` 失敗或公開頁意外變成 authenticated dynamic dependency。
- cache tag／URL redaction／timing helper 測試失敗。
- 多攤位複製回復成逐列 await／upsert。
- database test 的 RLS、cross-tenant 或重複 cron 驗證失敗。
- 公開 QR bundle 意外引入 admin-only 套件，可在取得穩定 build artifact size 後加入固定上限。

## 告警分級

- Warning：P75 超過預算一次或 P95 超過預算 1.5 倍。
- High：連續 15 分鐘超標，或 5xx > 1%。
- Critical：health 連續三次失敗、order submit P95 > 3 秒，或安全驗證／audit 寫入失敗。

每次調整 budget 必須保留前一版量測與原因，不得以放寬門檻掩蓋 regression。
