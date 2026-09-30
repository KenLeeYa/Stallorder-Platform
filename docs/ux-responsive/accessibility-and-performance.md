# 無障礙與效能基線

本輪是設計盤點，沒有改造後數值；不宣稱WCAG合規或效能改善完成。

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

固定來源 `2f8de0b7ac5a03c3235125a1848f8d35efe6a71d`，Next production build、Chromium、loopback、獨立 DB56822；完整原始樣本、量測程式、bundle 與資料集/旗標收據見 `artifacts/ux-responsive-20260930/a1-baseline/`。量測時 Edge 尚缺本 lab secret，正常訂單走產品真實 Circuit B 備援；後續已修復 Edge 並以同單 browser E2E 驗證 Circuit A，但**下列先期數值不可當 Circuit A 延遲**。量測時 demo 攤位有 18 單（READY 4、COMPLETED 12、EXPIRED 2）及 13 個 QA 商品，`DUAL_ORDER_INTAKE_ENABLED` 有本 lab 的暫時 global override。這是 A1 的小資料集先期值，**不能直接與後續 100+ 單比較**。

| 互動就緒（ms；30次／組） | 新 context p95 | 同 context p95 | 判定 |
|---|---:|---:|---|
| QR 390 商品可選 | 463 | NOT_RUN | 暖取樣第 11 次被本 lab 正常速率限制 429；只保留 10 筆有效樣本，429 不計 p95。冷樣本用不同保留測試網段合成訪客 IP，非單一訪客突發負載。 |
| Staff 1024 取餐查詢控制項可用 | 561 | 445 | 各 30 筆有效樣本；正常 UI 登入取得 session。 |
| KDS 1024 訂單品項區可見 | 228 | 405 | 各 30 筆有效樣本；KDS 指標是可見，不宣稱按鈕可操作時間。 |

QR 同互動 5 輪本機初步值：LCP 152–220ms、INP 48–56ms、CLS 0；不是 RUM 或實機分布。`scripts/audit-client-bundles.mjs` 8/8 route budget 通過，QR entry 84,586 B、Staff 97,830 B、KDS 85,094 B（未壓縮）；待 B3 固定相同 build/設定比較。公開 availability API 30 筆串行讀取 median 4ms、p95 10ms、error rate 0；Staff orders 的 APIRequestContext 30 筆全為非 200（代表性 401，後續 browser fetch 又受 429），**不給有效 latency p95**。人工作業時間、實機 Safari/Android、100+單與完整暖 QR／授權 API 30 筆為 NOT_RUN。

B3 必須在同一隔離 lab 建立固定 100+ 單、長名稱/備註資料，記錄資料 ID/數量、功能旗標、角色和設定。先停本 lab 的 3026 消費者，於不可變 A1 commit 重建/啟動 production app 對該固定資料集測 before，之後恢復目標 commit 並以相同方法測 after；全部切換前先提交各自工作，不能 reset DB、清理別人資料或碰 3023/55722。補足 QR 暖30與授權 API30（遵守原速率限制，跨有效窗口採樣），無效 401/429 不納入統計。若條件不能匹配，保留兩組原始值但不宣稱速度改善。

## WCAG 2.2 AA 目標驗收

- 320／360／390／768／820／1024／1280／1440；200%實際瀏覽器zoom與字體放大分別測，不用縮小viewport冒充zoom。
- 另驗1280px桌面400%zoom的320 CSS px等效reflow；寬表若需要二維捲動，逐項列必要性與替代摘要，不能將例外套到整頁或主動作。
- Tab／Shift-Tab／Enter／Space／Escape；skip link、focus可見、modal focus trap/restore、錯誤摘要與欄位關聯。
- 明暗模式的正文/次要文字/狀態/邊框/disabled與focus對比；測實際computed色彩，不只token表。
- 狀態有文字替代；重要付款結果不只toast；screen-reader smoke實際NVDA/VoiceOver環境不可取得則NOT_RUN。
- 手機／平板44×44 min，忙碌主動作48–56；父層clip／sticky遮擋／相鄰危險動作都需視覺檢查。
- iOS/iPadOSSafari、AndroidChrome實機旋轉、鍵盤、safe-area；桌機Chrome/Edge；不存在裝置不可宣稱通過。
- prefers-reduced-motion、少量aria-live、loading尺寸穩定、圖表文字摘要、繁中＋至少一個非中文。
