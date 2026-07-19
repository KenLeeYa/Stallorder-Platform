# 效能預算

## P75 目標

| 指標 | 預算 |
| --- | ---: |
| Homepage TTFB | <= 300 ms |
| Login page TTFB | <= 500 ms |
| QR menu useful content | <= 1.5 s |
| LCP | <= 2.5 s |
| Order session creation | <= 800 ms |
| Order submission | <= 1.5 s |
| Staff／Kitchen order list | <= 1 s |
| Merchant dashboard | <= 1.5 s |
| Health check | <= 300 ms |

`scripts/measure-response-time.mjs` 會對可量測項目產生 warning，但不因不穩定的 Internet latency 直接使 CI 失敗。第一筆帶 `Cache-Control: no-cache` 的要求是 cold-like，不宣稱一定觸發真正 Function cold start。

受 Deployment Protection 保護的 Preview 只可透過執行環境提供短效 share URL 或 bypass secret；量測器不會把 URL、token、Cookie、密碼或 secret 寫入 JSON、Markdown 或 console，且這些值不得加入 Git 或 CI artifact。

## 可重現門檻

CI 可穩定阻擋：

- `npm run build` 失敗，或 `/`、`/login` 意外失去 Static rendering。
- cache tag、URL redaction、timing、圖片 URL 與圖片處理測試失敗。
- 公開 GET 的 cache header 或私有 route bypass 測試失敗。
- database test 的 RLS、cross-tenant、cross-stall 或 cron ownership 驗證失敗。
- 取得穩定 build artifact 歷史後，公開 QR 首屏 bundle 超過已核准上限。

## 告警分級

- Warning：P75 超過預算一次，或 P95 超過預算 1.5 倍。
- High：連續 15 分鐘超標，或 5xx 超過 1%。
- Critical：health 連續三次失敗、order submit P95 超過 3 秒，或安全驗證／audit 寫入失敗。

調整預算時必須保留前一版量測與原因，不得以放寬門檻掩蓋 regression。
