# 離線 POS 測試計畫

## 自動化門檻

```powershell
npx prisma validate
npx prisma generate
npm run lint
npm run typecheck
npm test
npm run db:test
npx supabase db lint --level warning
npm run build
npm run test:e2e
$env:PLAYWRIGHT_PRODUCTION_SERVER='true'
npx playwright test e2e/offline-pwa-foundation.spec.ts
Remove-Item Env:PLAYWRIGHT_PRODUCTION_SERVER
npm audit --audit-level=moderate
```

正式建置模式的離線 E2E 必須驗證：

- 裝置登錄、管理者核准與唯一 Leader
- bootstrap、Service Worker、IndexedDB 與離線頁
- 斷線建單與重新載入後仍存在
- 本機狀態 `CONFIRMED -> PREPARING -> READY`
- 恢復連線後自動或手動同步
- canonical order 保留最終狀態及 `OFFLINE_POS` origin
- 相同 payload 重送得到 `DUPLICATE`
- 資料庫只有一筆 canonical order

## 資料庫安全

pgTAP 必須驗證：

- 新表 RLS enabled/forced
- anon/authenticated 無直接權限
- service role 只透過受信任 server 路徑
- organization/stall/device scope 與不可變欄位 trigger
- backend fencing
- receipt/idempotency 唯一約束
- TEST/SYSTEM_CANARY 不計入用量

## 人工情境

1. 現金：延續 OPEN shift、找零、同步後 expected cash 正確。
2. 人工付款：同步後仍為待對帳，沒有 provider confirmed 狀態。
3. 班別先關閉：產生付款／班別衝突，不遺失訂單。
4. 商品售罄或價格改變：保留交易快照並顯示衝突。
5. 列印停在 PRINTING：不自動補印，要求人工核對。
6. 裝置撤銷、Permit 到期、角色移除：禁止新單，既有佇列保留。
7. 多分頁：只有一個 coordinator 上傳。
8. 更新 PWA：待同步資料存在時不強制替換或刪除舊快取。

只可在隔離的 Staging 測試攤位建立測試訂單。Production 僅執行唯讀 smoke
test，除非有明確核准的測試攤位。
