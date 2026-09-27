# LINE 本機驗證與未完成項

日期：2026-09-26；分支 `codex/line-miniapp-pay-20260926`，基底 `766df1e217f9418739f6f907e9f4113fd02e3436`，修改未提交／未發布。

## 第一批基礎驗證紀錄

- 10 個 Vitest 檔案，71 tests PASS；其中新增 42 個案例屬協定、身分 claim 與公開連結的合成測試，其他 29 個為既有 provider、OA、bounded read、LOCAL_MOCK service 回歸。
- 新模組測試先建立；首次失敗為模組尚不存在，**不是**既有正式事故的行為重現證據。
- POST／GET HMAC 預期值由獨立 Python hmac/hashlib 計算，再固定為測試向量，測試不呼叫實作的 signer 算預期值。
- 第一批 TypeScript noEmit、針對新模組 ESLint PASS；當時尚未執行整合 build、隔離 DB migration 或真實 MINI 前端。第二批 DB／瀏覽器進度見下方。
- 最後補充 signed-int64 上限檢查並重用既有 bounded reader 後，受影響 3 檔 33 tests 再次 PASS，TypeScript／ESLint 再次 PASS；其他未修改回歸沿用同輪 71 項結果。
- 第一批無任何真實 Request／Confirm／Refund／OA push；當時未新增資料庫、容器或前端服務。

命令：

```powershell
node node_modules/vitest/vitest.mjs run src/server/payment-providers src/server/line-miniapp src/lib/line-miniapp-links.test.ts src/server/delivery-platforms/bounded-text-reader.test.ts src/server/notifications/line-oauth.test.ts src/server/notifications/line-messaging-provider.test.ts src/server/notifications/line-security.test.ts src/server/notifications/notification-job-processor.test.ts src/server/online-payments/online_order_payment_service.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js src/server/payment-providers/line-pay-v4.ts src/server/payment-providers/line-pay-v4.test.ts src/server/line-miniapp src/lib/line-miniapp-links.ts src/lib/line-miniapp-links.test.ts
```

Artifact：`C:/Users/KY/.codex/visualizations/2026/09/06/01a0761b-0cdb-73e1-82cc-59a3e93d5d66/ui-ux-redesign-20260923/controls-checkout-20260926/line-local-unit-results.json`。

## 原 prompt 完整流程矩陣

下表不把單元測試 PASS 冒充跨層流程 PASS。

| ID | 完整案例狀態 | 現有證據／尚缺 |
| --- | --- | --- |
| A01 | NOT_RUN | Session／challenge/API 與 DB fixture PASS；真實 LINE 登入待設定 |
| A02–A05 | NOT_RUN | 錯 issuer/aud/exp、env、跨 Provider、忽略 Email/role 單元 PASS；HTTP／Session／DB 已加本機 fixture；真實 provider 未測 |
| A06–A10 | NOT_RUN | 購物車、帳號切換、租戶／CSRF、SDK 失敗真實流程未實作／驗收 |
| B01 | BLOCKED | 使用者已有 Sandbox，設定位置待提供；Checkout/DB 銜接亦尚未完成 |
| B02–B04 | NOT_RUN | transport endpoint 狀態及 HTTP200錯誤單元 PASS；訂單／出單連動未測 |
| B05–B09 | NOT_RUN | 需 DB 金額、冪等、return state、並行與取消競態 |
| B10–B12 | NOT_RUN | transport 不重送與 unknown 單元 PASS；durable worker 崩潰恢復未做 |
| B13 | NOT_RUN | HTTP raw → parser → outbound URL ID 無損單元 PASS；DB/callback 全鏈缺 |
| B14 | PASS（協定單元） | POST／GET 固定 HMAC 向量；真實 LINE 接受仍待 Sandbox |
| B15–B22 | NOT_RUN | 基礎 TWD/金額證據檢查有測，庫存／超收／商家快照／入口旗標整合缺 |
| C01–C04 | NOT_RUN | transport 明確退款量有測；RBAC、餘額、並行、未知退款尚未銜接 |
| C05–C07 | NOT_RUN | 原 OA 單元回歸 PASS；真實 webhook/job 重送、封鎖與配額完整流程未測 |
| C08–C10 | NOT_RUN | MINI Service Message／通道策略未實作 |
| C11–C12 | NOT_RUN | 尚未導入付款至 KDS／Billing，不宣稱有連動驗收 |
| C13 | NOT_RUN | 部分既有 service 回歸 PASS，不是所有 QR／Web／現金實際流程 |
| C14 | NOT_RUN | 沒有任何 rich menu apply／restore 或 dry-run 工具 |
| C15–C18 | NOT_RUN | 僅局部環境、URL、token redaction 邊界測試；全系統安全驗收缺 |
| D iPhone/Android LINE | BLOCKED | 需 Channel、HTTPS 及實機；瀏覽器模擬不能替代 |
| D 一般 Safari/Chrome | NOT_RUN | MINI disabled shell/既有登入 browser PASS；SDK 成功流程未測 |

## UI 批次是另一個候選

3023 的 UI／找零改善在 `Stallorder-Platform-ui-ux-redesign-20260923`，不是本 LINE 分支：`docs/ui-ux/controls-checkout-20260926.md` 記錄真實 quick-login/composer/checkbox 的 browser QA。兩批驗收不可混用為 LINE 完整流程已通過。

## 第二批本次證據

- `line-regression-final.json`：78 PASS，0 skipped，含 8 個使用真實隔離 DB 的登入流程案例；LINE verify 回應仍是 fixture。
- Browser `e2e/line-miniapp-setup.spec.ts`：2 PASS，未設定時提示、CSP/referrer、無外部請求、既有商戶登入後進入儀表板、停用 API 回 503。不是 SDK 成功／Sandbox 的替代證據。
- 相關 TypeScript、ESLint 通過；完整 Production build／真實 Channel／支付授權／收退款／實機尚未驗證。
- 新增 migration 只在本機 clone 套用；既有 OAuth callback→Session 流程 regression PASS。clone 排除 cron/net 排程，未啟動 background jobs。這份 clone 的角色 grants 為本機 fixture，不作正式 RLS 完整驗收證據。
- 證據根目錄：`C:/Users/KY/.codex/visualizations/2026/09/06/01a0761b-0cdb-73e1-82cc-59a3e93d5d66/ui-ux-redesign-20260923/cash-row-20260926/`。
- 收尾：3024 候選服務已停止並讀回確認；3023 人工測試與共用本機 DB 55722 保留且健康，資料未刪除。需再測 LINE 候選時，在本工作樹執行 `node scripts/start-local-qa.mjs --port 3024`；先確認既有 DB 容器及隔離資料庫設定。服務證據為上述目錄的 `service-receipt.json`。
