# Phase 01：問題與驗收追蹤

以下為 2026-09-23 本輪盤點，狀態須隨實測更新；未測不等於通過。頻率為任務操作頻率推估，非正式遙測統計。

| ID | 等級／頻率 | 角色、路由與重現／證據 | 影響／風險 | 修正與驗收 | 狀態 |
|---|---|---|---|---|---|
| UX-01 | P1／每次接單 | Staff /staff/:slug；StaffTicketList 對所有訂單建立手機完整票，再建桌面列表 | 大量單的渲染、捲動、判讀成本；不改交易狀態 | 分頁、狀態與來源篩選、付款/列印摘要；100+ 訂單、重複更新、空篩選、resize | 已實作；見 verification-report 的對應流程 |
| UX-02 | P1／每次操作 | 平板三欄、長者模式與 200% zoom | 嚴重壓縮時可能無法操作；先實測再改斷點 | 360/768/1024/1280/1440，橫向溢出與所有主按鈕可達 | 本機核心畫面通過；硬體與其餘路由保留缺口 |
| UX-03 | P1／錯誤時 | Customer checkout blocker 一段訊息，須確認欄位定位 | 錯誤不易修復；不得修改建單冪等／未知付款邏輯 | 名稱、電話、地址 invalid/description，按錯誤摘要定位 | 已實作；見 verification-report 的對應流程 |
| UX-04 | P2／每日 | ProductAvailabilityEditor、SharedCatalogBoard 寫死中文 | 切換語系仍顯示中文；售完判斷保持 server | 共用字典、單一/批次、恢復日期、pending/failure | 已實作；見 verification-report 的對應流程 |
| UX-05 | P2／每次導覽 | Merchant/Admin 圖示導覽依 title 辨識 | 無 hover 裝置的發現性；不新增越權入口 | 既有功能按工作分組、清楚當前頁；保留 tenant/return context | 已實作分群搜尋、當前模組與平台側欄；本輪重新驗證 |
| UX-06 | P2／每日 | MultiStallDashboard 已有期間與 generatedAt | 不新增無來源圖表；確認時區/更新/空資料與精確表格 | 報表文字摘要與可下載範圍驗證 | 本機核心畫面通過；硬體與其餘路由保留缺口 |
| ENV-01 | 測試阻塞 | 本機初次編譯的導航 > 原測試 10 秒 | 不代表正式登入故障，禁止提高產品重試或放寬斷言 | 預熱核心頁後用原斷言重測，另測 production build | 預熱後通過，另保留初次失敗證據 |

## 本輪 QA 新增問題

| ID | 等級／頻率 | 角色、重現及根因證據 | 影響與修正 | 驗收結果 |
|---|---|---|---|---|
| UX-07 | P1／錯誤時 | 商品供應儲存中焦點留在 disabled input，按 Escape 可關閉視窗 | 將焦點移至 dialog，busy 時攔截 Escape；同步重入鎖 | 慢回應、連點、429/500/斷線保留日期與重試通過 |
| UX-08 | P1／手機巢狀操作 | 內層在 keydown 卸載，父層偵測不到 native dialog 而同時關閉 | Idle 用 native cancel；不提早卸載 | 320/390 手機關內層仍留商品導覽通過 |
| UX-09 | P1／暗色或輔具 | PWA span 無適當角色、暗色選取與平台設定對比不足 | 語意角色及集中配對 CSS | 五頁十種狀態＋六語 dialog axe 無違規 |
| UX-10 | P1／快速查期間 | 儀表板較早查詢晚回覆可能蓋過較新結果 | AbortController＋current request identity，網路失敗保留前次資料 | 亂序回覆、完全斷線、重試通過 |

## 續作與外部驗收範圍

| ID | 優先 | 範圍／原因 | 後續驗收 |
|---|---|---|---|
| UX-11 | P2 | 已實作商家分群目錄／位置及平台側欄，共用所有現有管理路由 | 本輪真實搜尋、導航、角色及裝置 QA |
| UX-12 | P2 | 已實作 sessionStorage allowlist，按攤位／角色 scope，失敗用記憶體；不保存客戶搜尋 | 真實重新整理與 parser 損毀／未知值回歸 |
| QA-01 | 發布前必須 | 實機印表機、通知、支付 provider、螢幕閱讀器沒有本次實機證據 | 見 accessibility 與 release-and-rollback-plan |
| REL-01 | 發布前必須 | 按攤位工作台旗標已實作並通過本機啟閉與權限驗證；Staging／正式驗收尚未進行 | 登錄預設關閉設定目錄，baseline readback，逐店開啟與可回退 |
| DATA-01 | P2 | 製作時間／列印失敗率／售完頻率沒有經確認的完整分母 | 先資料完整率及定義，再圖表與無障礙摘要 |

目前沒有由本輪重現確認的 P0；不代表已排除所有 P0。付款、列印、跨租戶若出現重大漏洞，停止擴大 UI 修改並優先處理。

## 全面續作實測缺陷

- UX-13／P1：在瀏覽器禁止 Storage 時，共用 NavigationStateManager 的讀取直接拋 SecurityError，登入 hydration 中斷。新增導覽儲存讀／寫／刪除降級並套用返回按鈕；儲存 getter 被拒、quota 滿及瀏覽器從登入開始封鎖 Storage 都有回歸。最終結果見續作驗證表。
- UX-14／P2：功能搜尋為 search input，Escape 可能只清空文字；明確處理為關閉功能視窗並返回觸發按鈕。真實鍵盤測試已覆蓋。

- UX-15／P1：SSR 音效與公休設定按鈕尚未 hydration 就可點擊，第一下被丟棄。改為 client ready 前 disabled；廚房／店員實際點擊與 Storage 被封鎖一起回歸，公休另以延遲 JS 的失敗前／成功後案例驗證。
- UX-16／P2：低頻工具被較高 specificity 樣式重新顯示；排除 secondary selector，測試實際可見元素。
- UX-17／P1：來源篩選的 LINE 常數與真正 LINE_DELIVERY 不一致，離線來源需讀 origin。統一唯讀分類、補來源契約及瀏覽器選取驗證，不修改原單狀態。
