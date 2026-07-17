# 多攤位測試計畫

## 測試層級

| 層級 | 指令 | 目的 |
| --- | --- | --- |
| Static | `npm run lint`, `npm run typecheck` | 程式品質與契約 |
| Unit/Integration | `npm run test` | RBAC、計價、摘要、CSV、狀態機、安全 helper |
| Database/RLS | `npm run db:test` | migration、constraint、RLS、RPC、跨 tenant/stall |
| Schema lint | `npx supabase db lint --local` | PostgreSQL function/schema 問題 |
| Build | `npm run build` | Production Next.js 編譯與路由 |
| Browser E2E | `npm run test:e2e` | Session、CSRF、API、Edge、UI、mobile 的整體流程 |

所有資料庫/E2E 必須先確認 `DATABASE_URL` 是 `localhost` 或 `127.0.0.1`。Production/staging 資料不可作自動測試清除目標。

## Unit coverage

- Effective product price 與 per-stall override。
- Organization aggregate 不平均各攤平均值。
- Dashboard 日期/攤位 filter 上限。
- Additional stall entitlement 與 invoice 計算。
- 完整 role permission matrix。
- Stall/ordering state transition。
- 訂單狀態、取消確認、取餐碼與 CSV formula injection。

## Database/RLS coverage

- Owner 讀取自己全部攤位，不能讀取其他組織。
- Org Admin `all_stalls` 與 selected stalls。
- Finance read-only。
- Stall Manager 指派攤位。
- Staff 多攤指派與未指派拒絕。
- Kitchen 排除待確認訂單及財務資料。
- Client 變更 organization/stall ID 不擴權。
- 跨 tenant order read 與跨 stall update 拒絕。
- Shared catalog scope/assignment/price。
- Summary timezone/rebuild/payment refresh。
- Realtime event/alert scope。
- Commercial/invitation token、最後 owner 保護、usage 去重。
- 32 張 public table 全部啟用並強制 RLS。

## Migration coverage

在 fresh reset 與舊版 fixture 升級路徑核對：

- tenant UUID/商戶資料成為 organization。
- stall、owner、manager/staff/kitchen membership 保留。
- orders/items/QR/audit 防濫用資料 scope 一致。
- product master 與 `stall_products` 數量/價格一致。
- payments、summary、event、subscription backfill 正確。
- compatibility view/trigger 不允許新舊 scope 不一致。

## Playwright 對應

`e2e/multi-stall.spec.ts` 以 serial、單 worker 執行，涵蓋附件的 12 項驗收：

1. Google PKCE start/callback 將已驗證 Email 連到 organization owner，並產生 audit。
2. Owner 由 UI 建立第二攤位。
3. 共用商品由 UI 分派兩攤。
4. 第二攤位由 UI 設定價格覆寫。
5. 兩個實際 QR session 的顧客菜單顯示各自價格。
6. Staff 可看指派攤，未指派攤回 404。
7. Owner 看到兩攤合併 summary。
8. URL 初始範圍只選一攤，API/表格只回該攤。
9. Finance 寫訂單 API 回 403。
10. Kitchen 財務報表回 404。
11. 跨組織 page/API manipulation 回 404。
12. 390×844 Dashboard 使用 mobile cards 且無水平溢出。

OAuth E2E 使用本機、僅測試的 Supabase Auth 相容模擬端點，以驗證應用 PKCE、callback、provider、verified Email、profile linking 與 session。外部 Google 同意頁不適合無憑證 CI，仍需在部署環境手動 smoke test。

## 完整驗收順序

```powershell
npm install
npm run db:reset
npm run db:test
npx supabase db lint --local
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
npm audit --audit-level=moderate
```

失敗時保存 pgTAP 輸出、request ID、Playwright trace/screenshot 與對應 JSON log；不得把 token、密碼、完整 IP 或 service key 附在 issue。
