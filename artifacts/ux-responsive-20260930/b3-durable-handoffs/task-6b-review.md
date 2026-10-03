# Independent A6.2 task review

Reviewer /root/responsive_a6b_review; BASE363d030..HEAD4a5b9a2. Spec compliance: FAIL; task quality: Needs fixes. No Critical. Read-only, no runtime/tests/DB writes. Full11commitdiff, focused unchanged checks for endpoint lookup authority, composer lifetime, baselineenv; submit/offline hunk required completing context.

## Important 1 (verbatim)

**第一次回應的不確定結果仍會逃離原單恢復鎖。**

位置：src/components/staff-order-composer.tsx:795、814、855。

`recoveringUnknown` 只有第一次 `fetch` 拒絕且 `navigator.onLine` 為 true 才成立。因此：

- 伺服器已提交 PAID，但第一次 201 本文損毀時，`response.json()` 的 `SyntaxError` 走進 `createOfflineFallback`，再被拒絕並落到一般錯誤；`busy` 清除後，原本的收款提示與編輯／關閉操作再次出現，沒有保存不可變的原 payload。
- 本文讀取發生 `TypeError`，或第一次 fetch 拒絕時瀏覽器已離線，則可能走 offline fallback；成功分支會換 key、消耗草稿並關閉 composer，沒有先確認原線上交易結果。

新增 Q03 案例固定讓第一次 fetch 拒絕，只在第二次恢復回應注入 HTML500，故未涵蓋上述路徑。

**修正：** 對已送出的現金提交保留原序列化 payload／key；任何無法確定結果的首次回應都應進入同一恢復狀態。明確的授權／驗證拒絕維持原處理。不得僅依失敗後的 `navigator.onLine` 判定原請求未提交。

**建議有界回歸：** 真實 201/PAID 提交後，分別破壞第一次本文，以及切換離線後丟失第一次回應；確認不再顯示收款提示、不建立 offline 替代單、不換 key，恢復後仍只有原 order/payment。此次未執行測試或啟動 runtime。

## Minor 2 (deferred)

**未付款提交也顯示「請勿再次收款」。**

src/components/staff-order-composer.tsx:934 對所有 `uncertainRequest` 無條件使用 `composer.paymentUncertain`，但該狀態也涵蓋 `PAY_LATER`。建議依原 `paymentTiming` 顯示「訂單結果尚未確認」或收款結果文字，避免誤導現場人員。

## Strengths

- kitchen-board.tsx:79 org/stall/slug/role session boundary resets state simply.
- product-stock-editor.tsx:50 existing409/STOCK_CHANGED refresh preserves per-product valid-version drafts without backendchange.
- responsive-env.ts:5/playwright.responsive.config.ts:1 initialization fix matches actualcause and freshprocessregression.
- staff-order-create.ts:103 existing lookup-first authority supports original-key recovery beforeprepare/checkout.

## Cannot verify from diff

Final samecandidate sixfile combinedrun is B3; Primary currentbaseline root read-only receipt; realprinter/provider outside local scope. Report correctly distinguishes historical test rounds and final packaging rebuild. Controller retains these boundaries, no impliedPASS.
