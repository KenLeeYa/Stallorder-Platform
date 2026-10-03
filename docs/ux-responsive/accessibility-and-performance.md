# 無障礙與效能基線

本文件保留原始設計盤點、A1先期值與後續B3驗證；各節分開記錄日期、資料集及證據範圍，不宣稱WCAG合規或整體效能改善完成。

## 現有可驗證證據

| 項目 | Before | After |
|---|---|---|
| Staff整頁水平寬度 | 1440→document1425；1024→1009；768→753；390→375；360→345 CSS px（含直捲軸差異） | NOT_RUN |
| 768三欄 | 約211／294／200px；左／右閱讀空間緊，無整頁横溢 | NOT_RUN |
| 手機可見訂單操作 | 查看明細36px、完成訂單36px、取消42px高；觸控目標未達44基線 | NOT_RUN |
| POS Escape | 空草稿，在關閉按鈕按Escape仍1個dialog；點關閉才0個 | NOT_RUN |
| 共用現有能力 | globals已有focus-visible、safe-area、reduced-motion；QR已有Tab／Escape／focus restore | 全消費面NOT_RUN |
| 控制項原始掃描 | viewport-measurements.json含popover子項；rect有尺寸不一定可見。不得把全部smallControls當確認缺陷 | 待精確可見性／遮擋測試 |

證據是Windows Chrome viewport override，不是觸控真機；沒有模擬iOS安全區或虛擬鍵盤。第三方擴充浮層不計入產品缺陷。正式匿名HTTP基線不計入應用task latency。

## 候選實作前必補量測

下表保留設計盤點當時的缺口；後續B3量測不會把A1不同資料集的先期值改寫成可比基準。

| 指標 | 採樣設計 | 目前結果 |
|---|---|---|
| 任務時間／點擊／回退 | 固定商品與訂單fixture，每角色同一任務；記錄開始/完成界線、熟悉度、輸入裝置；建議每組5次，個別值＋中位數 | NOT_RUN；不以工具延遲代替人工作業時間 |
| 畫面可互動p95 | 固定production-mode本機build、相同資料／硬體／network；分冷／暖各至少30次並記全部樣本 | NOT_RUN；樣本不足不填p95 |
| LCP／INP／CLS | 同頁相同互動、相同視窗；測5輪為初步lab值；INP需實際互動，非真實使用者分布 | NOT_RUN |
| Bundle | 同build設定比較route JS與共享bundle；記SHA、指令、報表 | NOT_RUN |
| API latency | 同角色/授權/local DB，串行讀取同endpoint至少30筆；中位與p95、error rate；mutation只隔離fixture | NOT_RUN |
| 100+單 | 固定100+測試單、長品名/備註；保留五筆分頁；不載入全部冒充順暢 | 3023可見143筆只是資料存在，非效能PASS |

合理目標在候選基準取得後確定：不得用主機冷編譯波動宣稱改版提升；比較樣本量、版本、環境一致才解讀差異。安全/任務正確性優先，不能為速度略過server授權。

## A1 production-mode 本機先期數值（2026-09-30）

原始量測使用當時的 Next production build、Chromium、loopback、獨立 DB56822；完整原始樣本、量測程式、bundle 與資料集/旗標收據見 `artifacts/ux-responsive-20260930/a1-baseline/`。原收據靜態標示 `2f8de0b7ac5a03c3235125a1848f8d35efe6a71d`，未驗證 build provenance，已改記 `reportedRevisionUnverified`。量測時 Edge 尚缺本 lab secret，正常訂單走產品真實 Circuit B 備援；後續已修復 Edge 並以同單 browser E2E 驗證 Circuit A，但**下列先期數值不可當 Circuit A 延遲或正式 before/after**。量測時 demo 攤位有 18 單（READY 4、COMPLETED 12、EXPIRED 2）及 13 個 QA 商品，`DUAL_ORDER_INTAKE_ENABLED` 有本 lab 的暫時 global override。這是 A1 的小資料集先期值，**不能直接與後續 100+ 單比較**。

| 互動就緒（ms；30次／組） | 新 context p95 | 同 context p95 | 判定 |
|---|---:|---:|---|
| QR 390 商品可選 | 463 | NOT_RUN | 暖取樣第 11 次被本 lab 正常速率限制 429；只保留 10 筆有效樣本，429 不計 p95。冷樣本用不同保留測試網段合成訪客 IP，非單一訪客突發負載。 |
| Staff 1024 取餐查詢控制項可用 | 561 | 445 | 各 30 筆有效樣本；正常 UI 登入取得 session。 |
| KDS 1024 訂單品項區可見 | 228 | 405 | 各 30 筆有效樣本；KDS 指標是可見，不宣稱按鈕可操作時間。 |

QR 同互動 5 輪本機初步值：LCP 152–220ms、INP 48–56ms、CLS 0；不是 RUM 或實機分布。`scripts/audit-client-bundles.mjs` 8/8 route budget 通過，QR entry 84,586 B、Staff 97,830 B、KDS 85,094 B（未壓縮）；待 B3 固定相同 build/設定比較。公開 availability API 30 筆串行讀取 median 4ms、p95 10ms、error rate 0；Staff orders 的 APIRequestContext 30 筆全為非 200（代表性 401，後續 browser fetch 又受 429），**不給有效 latency p95**。人工作業時間、實機 Safari/Android、100+單與完整暖 QR／授權 API 30 筆為 NOT_RUN。

B3 使用同一隔離 lab 的固定 100+ 單、長名稱/備註資料，記錄資料 ID/數量、功能旗標、角色和設定。不可變 A1 以 `git archive` 匯出到新建、受控的來源 artifact，驗證所有 tracked blob 與原 Git tree 完全一致；若 build wrapper 需要 Git 身分，另建 snapshot provenance commit，明記它與原 A1 commit 的差異及相同 tree。不得 checkout/detach 任何既有工作樹，也不得修改 baseline 產品。兩個來源使用獨立 `.next`；每次 build 前只停 owned3026，先載入精確 lab env 再載入舊 config defaults。保持候選 branch/ref、DB、3023/55722 與其他工作不變。QR 冷/暖各30與授權 API30遵守原速率限制、跨有效窗口採樣；無效401/429另計，不納入成功 latency。若條件不能匹配，保留原始值但不宣稱速度改善。

## WCAG 2.2 AA 目標驗收

- 320／360／390／768／820／1024／1280／1440；200%實際瀏覽器zoom與字體放大分別測，不用縮小viewport冒充zoom。
- 另驗1280px桌面400%zoom的320 CSS px等效reflow；寬表若需要二維捲動，逐項列必要性與替代摘要，不能將例外套到整頁或主動作。
- Tab／Shift-Tab／Enter／Space／Escape；skip link、focus可見、modal focus trap/restore、錯誤摘要與欄位關聯。
- 明暗模式的正文/次要文字/狀態/邊框/disabled與focus對比；測實際computed色彩，不只token表。
- 狀態有文字替代；重要付款結果不只toast；screen-reader smoke實際NVDA/VoiceOver環境不可取得則NOT_RUN。
- 手機／平板44×44 min，忙碌主動作48–56；父層clip／sticky遮擋／相鄰危險動作都需視覺檢查。
- iOS/iPadOSSafari、AndroidChrome實機旋轉、鍵盤、safe-area；桌機Chrome/Edge；不存在裝置不可宣稱通過。
- prefers-reduced-motion、少量aria-live、loading尺寸穩定、圖表文字摘要、繁中＋至少一個非中文。

## B3.1 local accessibility acceptance

B3.1 uses `e2e/responsive-accessibility.spec.ts` and the route matrix on the isolated production build at 3026. The matrix operates customer configuration, Staff detail, POS catalog, KDS selection, Merchant catalog selection, Admin record disclosure and the existing MINI capability-gated entry at eight widths, zh-TW/light and en/dark. It records uncovered targets, keyboard focus/trap/restore, reduced-motion preference and actual axe contrast data. This is not a WCAG certification or a physical-device claim. Exact commands, source/build identifiers, failed attempts and final results are in `.superpowers/sdd/2026-09-30-responsive-management-verification/task-3a-report.md`.

Reproduced fixes are limited to cancellation of an obsolete missing-order focus frame, a 48px KDS completion action, a named Merchant QR SVG, a 44px theme toggle, and a scrolling QR configuration dialog at short viewport heights. Native Chrome/Edge browser settings tests distinguish page zoom from default text size; screenshots and geometric readbacks are retained separately from viewport emulation. Windows Chrome native window rounding is recorded using its actual baseline rather than claiming an exact 1280px baseline; Edge covers the requested exact reflow geometry.

The retained `responsive-b3-fixed-120-v1` dataset has 120 deterministic synthetic CONFIRMED orders with long names/notes; `b3-accessibility/fixed-dataset.json` records every order ID, creation time, hash, settings and flags. B3.2 must freeze and read this same dataset on both revisions, without reseeding, resetting, completing orders or changing flags between samples. The dedicated `b3-fixed-locale` menu and inactive CSV import product are separate UI fixtures; do not use their creation as a performance comparison.

Physical iPhone/iPad Safari and Android Chrome, NVDA/VoiceOver, and five human task timings per role remain NOT_RUN. On the retained lab, operators must exercise portrait/landscape, keyboard opening, safe-area bottom actions and real touch; run screen-reader heading/control/error/status traversal and dialog return; record five real humans' elapsed task times per role with the same task/fixture. Automation durations are not those measurements. Paired performance and the full combined suite belong to B3.2/B3.3.

## B3.2 paired performance results

2026-09-30 isolated production-mode measurement is complete **with concerns**, not a speed-improvement or release claim. Immutable original A1 `a0c635bc8177abd953fd7381d85fbbaf22cf1fe1` was exported into a new artifact and verified against all2,563 tracked blobs; snapshot commit `3e586386d8b916b7e68c5242bc344155e9410fd5` has the identical tree and build `ZRPD1C0hp87hIxeN-6rwI`. Candidate `c1ef63884b7ec731942fe11e0a347f29d9dc174d` used build `rcKKnUtHI8cnstCJFVw4b`. Neither an existing checkout nor the business dataset was switched/reset. Full commands, provenance, failures and B3.3 source/start handoff are in `.superpowers/sdd/2026-09-30-responsive-management-verification/task-3b-report.md`; raw evidence is in `artifacts/ux-responsive-20260930/b3-performance/`.

Both phases used the same fixed120 order/item/task hashes and surrounding231orders/214products/146tasks, settings, flags, role, routes, actual Chromium browser session cookies, measurement/statistics hashes and machine. BEFORE14:16:52–14:52:15UTC, AFTER14:55:34–15:25:45UTC; both precede Taipei midnight. Report query/input date was fixed2026-09-30; KDS elapsed labels and refreshed times naturally advanced. Cold is a fresh browser context with empty HTTP cache; server/OS remain warm. Warm retains one context/page/identity after a priming interaction. Timings include navigation through a genuine readonly action and asserted result, not merely a visible marker. All series run serially; actual429 attempts and ordinary Retry-After waits remain separate from valid latency.

Goals were registered after full BEFORE and before AFTER, against sanitized BEFORE SHA256 `b35de6e47a2b3892b5011c1f7d5a96fd76b01430916af8617f6fb0c43457d8aa`: reduce median by at least baseline IQR, without increased p95 or invalid-attempt rate. IQR is observed spread, not statistical confidence. **All11 timing goals are NOT_MET**; do not claim improvement within noise or attribute this single sequential comparison solely to code.

Each row has30 valid samples per phase; units ms. Invalid ratios use all attempts, not30 as denominator. API availability is public, measured in owner browser context; it is not a report-data API.

| Series | Before median / p95 | After median / p95 | Median goal ≤ | Goal | Invalid before → after |
| --- | ---: | ---: | ---: | --- | --- |
| QR390 cold | 1313.50 /1418.0 | 1277.75 /1432.4 | 1278.10 | NOT_MET | 1/31 →1/31 |
| QR390 warm | 516.30 /761.5 | 516.15 /2295.1 | 400.30 | NOT_MET | 3/33 →3/33 |
| Staff1024 cold | 1029.65 /1208.0 | 919.75 /3866.8 | 898.75 | NOT_MET | 0/30 →0/30 |
| Staff1024 warm | 912.00 /1142.5 | 829.45 /1084.1 | 749.60 | NOT_MET | 1/31 →1/31 |
| KDS1024 cold | 307.80 /597.5 | 324.95 /617.7 | 260.40 | NOT_MET | 3/33 →0/30 |
| KDS1024 warm | 283.95 /622.4 | 309.00 /482.9 | 241.45 | NOT_MET | 2/32 →0/30 |
| Report390 cold | 290.90 /339.3 | 298.75 /390.5 | 273.20 | NOT_MET | 0/30 →0/30 |
| Report390 warm | 158.15 /190.9 | 164.60 /485.0 | 131.45 | NOT_MET | 0/30 →0/30 |
| Staff orders API | 36.85 /76.8 | 38.65 /83.6 | 30.85 | NOT_MET | 0/30 →0/30 |
| KDS board API | 67.45 /89.1 | 66.10 /116.9 | 57.45 | NOT_MET | 0/30 →0/30 |
| Public availability API | 3.45 /12.2 | 4.30 /16.5 | 2.25 | NOT_MET | 0/30 →0/30 |

The QR warm, Staff cold and report warm tails are observed regressions in this run and require focused follow-up before any improvement claim. They were retained, not trimmed or selectively rerun. AFTER QR/warm attempt6 at15:01:43.258Z took2873ms with a35.6ms server request; Staff/cold attempt21 at15:18:45.725Z took3964.5ms with server total1816.9ms (recorded dbMs1816.6/auth195.4); report/warm attempt16 at15:25:08.938Z took486.1ms with server46.8ms. Exact request IDs and further tails are in `tail-server-correlations.json`. Server spans correlate temporally but do not explain the whole browser duration; no resource waterfall, per-action phase trace or contemporaneous CPU trace exists. No product root cause is asserted.

Five genuine lab interaction rounds per flow/phase, zero invalid rounds; p95 below is the five-round maximum, not a population tail. All observed INP values were uncensored; raw EventTiming events and layout shifts are retained. No RUM, human task-time, physical-device or WCAG certification claim follows.

| Flow / phase | LCP median / max ms | INP median / max ms | CLS median / max |
| --- | ---: | ---: | ---: |
| QR before | 220 /232 | 56 /56 | 0 /0 |
| QR after | 204 /236 | 64 /72 | 0 /0 |
| Staff before | 656 /772 | 24 /64 | 0 /0.0008855 |
| Staff after | 440 /728 | 32 /56 | 0 /0.0008855 |
| KDS before | 172 /256 | 24 /24 | 0.0004924 /0.0004924 |
| KDS after | 212 /280 | 24 /32 | 0.0004924 /0.0004924 |
| Report before | 184 /208 | 16 /16 | 0 /0 |
| Report after | 184 /192 | 16 /16 | 0 /0 |

Same-build uncompressed **entry JS**, not complete lazy-loaded payload: QR84586→84586B, Staff97830→97830B, KDS85094→85094B, report136033→136314B (**+281B**, no-growth goal NOT_MET); the four-route shared intersection79827→79827B. Per-chunk SHA256 is retained. Existing `performance:bundles` budgets pass8/8 on both builds; those budgets do not include this report route and do not convert its growth into a met goal.

Route invalid-attempt rate was10/250=4.00% before and5/245=2.04% after; each failed attempt involved actual429. Authorized selected API failures were0/90 per phase, with200/JSON plus body-contract assertions. Only exact optional attendance409/`ATTENDANCE_DISABLED` is classified separately. Console records contain152/134 rate errors,66/65 attendance errors and one localhost websocket CSP violation in each phase; counts include automatic retries during untimed waits and are not unique request counts. Known key values were redacted without dropping these diagnostics, with local-account-only originals retained outside Git. No clean-console claim or SSE fix follows. The older storefront stream-closed issue remains unresolved; this performance run did not exercise that storefront loop. Physical devices, assistive technology, human timings, complete role keyframes and final combined B3.3 QA remain separate open gates.

B3.2 review fix: the statistics tests now use the repository's Vitest runner. Focused RED reproduced `No test suite found`; GREEN passes5/5, preserving the exact1s gap and4950ms first-shift-anchor cases and adding a true5000ms window boundary. Historical Node-runner logs remain unchanged. The statistics/measurement algorithms and paired receipts did not change; test coverage does not alter the negative performance findings above.

## B3.3 合併候選與視覺界線

[56 張前後關鍵畫面與 SHA-256](../../artifacts/ux-responsive-20260930/b3-keyframes-manifest.json)補齊七角色各 390／768／1024／1440 CSS px；before A1 與 after B3.1 為不同日期的程式版本畫面。B3.3 只改測試／fixture，未變更 B3.2 已量測的產品程式。120 筆原始凍結資料在 B3.2 量測期間確實相同；後續 B3.3 整批測試曾觸發 120 task 取消並按精確 preimage 修復，正常觸發器使 `updatedAt` 改變，因此不能拿目前資料重新宣稱原配對全欄位 hash 仍相同。全部 11 項時間目標 NOT_MET 與 QR warm、Staff cold、report warm tail 仍有效且未被測試修正覆蓋。商品 session 的 100 筆上限、現場 storefront stream 警告另見[合併 QA 索引](b3-final-qa-evidence.md)。實體裝置、讀屏與五人作業時間仍 NOT_RUN。
