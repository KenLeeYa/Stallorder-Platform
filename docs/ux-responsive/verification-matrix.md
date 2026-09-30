# 驗收矩陣與證據狀態

本輪 A1 未改產品程式。下列早期「已存在」只表示找到測試原始碼；新增 A1 實測收據見本頁末段。設計與[實作測試計畫](../superpowers/plans/2026-09-30-responsive-cross-device.md)已核准。

## 本輪已做

| 檢查 | 結果 |
|---|---|
| 完整需求、工作樹／程序／容器／候選盤點 | 完成唯讀盤點；保留dirty與3023 |
| 候選原始碼 UI 與狀態兩個agent盤點 | SOURCE_OBSERVED；無產品改檔 |
| 3023 Staff/POS/Menu/KDS/Merchant/Admin主要頁五尺寸before | 30張BROWSER_BASELINE；見artifacts索引；不是候選閉環 |
| 空POS Escape／關閉 | 已重現差異：Escape未關、明確close可關；未建单 |
| Production專案／部署／alias／匿名entry／availability | READ_ONLY_OBSERVED；不是完整登入／有效QR交易PASS |
| Typecheck／lint／unit／integration／DB-RLS／E2E／build | NOT_RUN：尚未實作；不冒用歷史結果 |

## 需求與回歸對照

| ID／優先 | 案例 | 既有可復用入口 | 本次狀態 |
|---|---|---|---|
| RSP-Q01 P1 | 顧客390下單→Staff1024接單→KDS→顧客追蹤→desktop同單；同鍵重送唯一 | `e2e/customer-order-functional-qa-local.spec.ts`、`e2e/catalog-operations-local.spec.ts`、`e2e/kds-production-board.spec.ts` | A1 既有功能單筆同單閉環 LOCAL_BASELINE_PASS；同鍵重送唯一尚未在 A1 測，留後續回歸 |
| RSP-Q02 P1 | 8寬度、直橫、200%zoom、長字與非中文；主要CTA無橫滑/遮擋 | `e2e/staff-orders-print-runtime-responsive.spec.ts`、`e2e/line-platform-v2.spec.ts` | 部分before；候選NOT_RUN |
| RSP-Q03 P1 | POS／商品／QR dialog Tab trap、Escape、focus restore、巢狀、dirty close | QR lifecycle單測；新增POS/商品keyboard regression | POS before已觀察缺陷，修正NOT_RUN |
| RSP-Q04 P1 | KDS慢舊回應／重複invalidation／切店／卸載／offline重連；snapshot與stream ready之間更新仍讀到最新 | `src/lib/use-live-resource.test.ts`、`src/components/staff-order-board-live.test.ts` | KDS新增失敗例NOT_RUN |
| RSP-Q05 P1 | 旋轉保留filter／selected order／draft，重讀snapshot | `e2e/staff-orders-print-runtime-responsive.spec.ts`、`e2e/kds-production-board.spec.ts`為既有版面基礎 | 狀態保留＋snapshot須新增；NOT_RUN |
| RSP-Q06 P1 | desktop售罄→手機舊菜單被拒、草稿可修復 | `e2e/catalog-availability-amendments-local.spec.ts:266` | NOT_RUN |
| RSP-Q07 P1 | 401/403撤權清除舊畫面；A/B組織、同org不同stall、共用裝置換人 | `e2e/multi-stall.spec.ts:496,844`；DB測試 `multi_stall_rls.test.sql`、`operational_realtime.test.sql` | NOT_RUN |
| RSP-Q08 P1 | 409/422/429/500/HTML/timeout；付款未知查原attempt | `e2e/customer-order-functional-qa-local.spec.ts:204,233`；`src/server/payment-providers/line-platform-payment.integration.test.ts` | NOT_RUN |
| RSP-Q09 P1 | 四組KDS/列印開關皆可終結；重印不重收款、硬體另分 | `e2e/staff-kds-print-closure-flow.spec.ts:173,414,499,704` | NOT_RUN；紙本/錢櫃需實機 |
| RSP-Q10 P1 | QR用途/owner/expiry/原子核銷；改時段撤舊碼，ready通知無需顧客開頁 | `src/server/line-platform/pickup.integration.test.ts`、`src/server/line-platform/notification.integration.test.ts`、`src/server/line-platform/fulfillment-event.integration.test.ts` | NOT_RUN；不重用PR365舊實機結果 |
| RSP-Q11 P2 | Admin寬表手機/平板仍有sort/filter/export/detail與全部授權操作 | 現有Admin cards＋新增table/callback回歸 | NOT_RUN |
| RSP-Q12 P2 | 100+單、empty、partial success、弱網、有界refresh | 現有local fixtures；新增壓力資料需隔離 | NOT_RUN |
| RSP-Q13 P2 | 平台单一OA；API接受不等於送達；各店Pay connection分開 | `src/server/line-platform/notification.integration.test.ts`、`src/server/line-platform/member.integration.test.ts`、`src/server/payment-providers/line-platform-payment.integration.test.ts` | NOT_RUN；不啟正式provider |
| RSP-Q14 P1 | 有旗標的新舊Staff renderer與純角色/商家代入都測 | staff-workspace-rollout＋header/layout e2e | NOT_RUN；不得省略legacy |

共用 QA 對照：QA-UI-01～10、QA-ROLE-01～06、STAFF-013A、KDS-004、MER-007/013/017/022、ADM-005/008、HEALTH-001。實作時把新回歸寫進repo，不只更新此表。

## 指令與服務前置條件

現行scripts：`npm run typecheck`、`npm run lint`、`npm test`、`npm run build`、`npm run db:test`、`npm run test:e2e`。最後兩者不可無條件執行：`db:test`走Supabase test db；E2E可能啟動functions，先讀config/ports/DB ownership。

LINE runner `node scripts/run-line-platform-qa.mjs unit|database|browser` 的database/browser限定本機55722、DB `stallorder_line_miniapp_20260926`，browser預設HTTPS3024，**不是3023**。不可套用Production或任意改共享DB。

每批需same SHA＋dirty patch hash＋fixture＋命令exit code＋測試計數＋skip理由＋截圖。時間過期或不同分支證據不可合併成PASS。受影響功能全流程未過之前不標LOCAL_VERIFIED。

| 完成標記 | 本輪 |
|---|---|
| LOCAL_VERIFIED（新版功能） | 否；只有盤點／before觀察 |
| STAGING_VERIFIED | 否；未部署 |
| PRODUCTION_APPROVED | 否；本輪未請求發布 |
| PRODUCTION_OBSERVED（新版功能） | 否；僅既有正式站唯讀基線 |

## 2026-09-30 A1 候選真實本機閉環

- 原始來源 `2f8de0b7ac5a03c3235125a1848f8d35efe6a71d`，獨立 app3026／Supabase API56821／DB56822，Next production build；`PLAYWRIGHT_PRODUCTION_SERVER=true npx playwright test -c playwright.responsive.config.ts e2e/responsive-order-roundtrip.spec.ts --reporter=list`：1 passed。瀏覽器實際 Edge Circuit A 建 session 201、送單 201；顧客 UI 客製兩份共 130 → Staff 接單 → KDS 製作、READY → 桌機 Staff 現金收款 → 顧客 UI 3 位取餐碼於 Staff UI 核驗 → 同一 orderId `COMPLETED`，顧客追蹤同步完成。無 `page.route().fulfill()`；fixture 只在本 lab 建立。
- 固定 Circuit A 收據、四端 before 截圖與完成追蹤：`artifacts/ux-responsive-20260930/a1-baseline/`；較早的真實 Circuit B 備援同單收據另存 `same-order-receipt-circuit-b.json`。收據記錄 orderId、事件、時間、數量及金額；個別 UI/DB 驗證範圍是本機合成資料，非實機、Staging 或 Production。Production 唯讀可用性收據另在同層 `production-execution-baseline.json`，不等同交易驗證。
- A1 尚未覆蓋同鍵重送、100+單、各種 viewport/zoom、撤權、故障注入、LINE provider、紙本/錢櫃及真實裝置。這些案例保持 NOT_RUN，依 A2–B3 任務驗收；不可把 A1 的單筆閉環擴大稱為新版功能完成。
