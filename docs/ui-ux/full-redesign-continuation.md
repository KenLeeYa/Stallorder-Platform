# 全面改版續作 — 2026-09-23

依使用者「直接依序完成 prompt 內的整體改版」接續 `896ab68`，仍在 `codex/ui-ux-redesign-20260923`。前一版的完成證據不涵蓋下列新增改動；本輪另跑 QA，不把上輪成功次數重複列為新證據。

## 批次與驗收

1. Phase 00–01：保留已完成的真實路由／交易與競品盤點；重新讀程式與原 prompt。正式只讀 HTTP 基準：登入、店員登入、connectivity 正常，health 未登入受限。Vercel get_project 的 schema 不相容，改以 list_deployments／get_deployment 成功讀回 Primary prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP、dpl_Cx8GfP12KuFHcCgtnZ7SXxzt4AYZ、main 5cc15c6、READY；本輪無遠端寫入。
2. Phase 02–03：商家最多五個一級文字入口、兩步到可搜尋分組目錄；平台寬螢幕左側分群、手機目錄；依相同權限篩選後才傳入共用導覽。驗收語系、role gating、scope、現在位置、鍵盤及焦點。
3. Phase 04–05：保留 authoritative 訂單／付款／列印 controller，工作台補來源、品項與備註摘要。非敏感篩選僅存目前瀏覽器分頁 session，以攤位／角色區隔；不存搜尋內容、訂單或顧客資料。驗收重新整理、損毀／停用 storage、原狀態流程與原票列印。
4. Phase 06：菜單依翻譯後名稱、說明、分類及群組搜尋；無結果可清除，客製中的商品不因搜尋消失。未滿足必選時提供具體群組定位。既有選項、價格、恢復／冪等／追蹤進度不重造。
5. Phase 07：供應模式原本兩次操作可完成今日售完；加入批次影響商品清單、單攤位範圍及恢復方式。儲存仍用原子 API，失敗保留原選擇；不新增越權批次更新或用反向交易冒充 undo。
6. Phase 08：平台首頁以真實待審申請、待確認付款與 PAYG 異常作可點擊待辦；訂閱管理新增名稱／編號及狀態篩選、五筆分頁、窄螢幕卡片。只序列化 UI 需要欄位，不傳完整 organization 物件到 client。
7. Phase 09–11：報表保持 server rendering，加入實際門市時區、讀取時間與計算定義，時段長條搭配精確文字值；匯出前顯示日期與資訊敏感性。缺少可靠分母的製作／售罄／列印失敗率不造數據。沿用既有即時去重、rollback、離線 queue、安全日誌模型並跑相關測試。
8. Phase 12–15：每項改動新增有行為結果的測試；重跑原核心、錯誤、權限、明暗／斷點／鍵盤及 build／bundle gate。更新所有必要文件及本次 receipts，停止本次 DB／Next 程序，保留資料。

## Before / After / Why

| Before | After | Why |
|---|---|---|
| 十多個圖示在同一橫列，需要記憶或 hover | 四至五個文字主入口＋可搜尋分組目錄，平台 desktop 側欄 | 觸控可辨識，低頻設定可找到但不佔主工作列 |
| 工作清單主要看單號／客名，重整清空篩選 | 補來源、品項、備註，分頁 session 記住非敏感偏好 | 尖峰判讀與中途續作更直接 |
| 顧客逐分類找餐點，必選錯誤只有概括文字 | 多語菜單搜尋、無結果提示、直接定位未完成群組 | 減少來回捲動，保留同一購物車 |
| 批次只顯示商品數 | 可展開受影響商品及恢復方法 | 讓確認內容具體，區分共用主檔與單攤位設定 |
| 平台首頁先看大量統計卡，商家長清單 | 可操作待辦置頂、商家搜尋與狀態／分頁 | 先處理工作，再看摘要，避免無限清單 |
| 時段數字格沒有相對比較，讀值定義不易找到 | 同資料小長條＋文字、定義／時區／讀取時間 | 有可回答的問題，保留精確值且不引入圖表套件 |

## 業務與安全邊界

沒有變動 RLS、schema、交易狀態、扣款、退款、列印重試、主備 writer、OAuth 或正式設定。搜尋只有已授權導航／管理頁面既有資料，伺服器授權不由 UI 代替。新控件採既有原生語意／dialog／message catalog；沒有引入新的前端依賴。

人工證據的剩餘項目集中於 release-and-rollback-plan：真實印表機、支付 provider、iPad／Android 通知、螢幕閱讀器與正式 rollout。這些不因本機 UI 測試通過而標記完成。

## QA 找到並修復的共用問題

瀏覽器在初始腳本封鎖 Storage get/set/remove 時，NavigationStateManager 於 root effect 拋出 SecurityError，使測試登入按鈕一直 disabled。補上 optional navigation memory 的安全讀寫，ContextualBackButton 同步降級為已驗證的 fallback 路徑；未放寬 cookie、登入或 API 驗證。新增真實登入＋篩選與純函式 getter-denied／quota 回歸。


續作另以真實瀏覽器找出並處理：

- 音效控制在 server HTML 已顯示、client handler 尚未掛上時會漏接點擊。店員與廚房共用 client-ready 控制，在可互動前原生 disabled；偏好讀取的排程使用目前 ref，避免蓋掉剛點擊的新值。沒有用測試睡眠掩蓋問題。
- 低頻工具的 display:none 被後續主要按鈕樣式覆蓋。主要樣式明確排除 secondary tools，新增實際可見元素斷言。
- LINE 訂單實際 source 為 LINE_DELIVERY；離線單使用 source=STAFF_POS、origin=OFFLINE_POS。唯讀 StaffOrderDto 增加既有 origin 的序列化（相容欄位），依共同分類函式顯示及篩選，未知來源顯示「其他來源」，不再誤寫「全部來源」。不新增 schema、交易或授權欄位。
- 撤權測試在 request 送出但回應中斷時，也可能已完成 DB 寫入；fixture 復原標記在送出前設立，確保 finally 會核對及恢復原角色。
- 公休設定的首次開啟亦重現 hydration 前漏接點擊。新增延後 `/_next/static/**/*.js` 的瀏覽器案例：修正前 SSR 按鈕仍 enabled，修正後等待 handler 掛上才啟用；接續驗證新增、Menu／QR 公告、阻擋點餐及刪除設定。這不是測試增加 sleep 或重複點擊。
- 截圖須等待 dashboard 完成讀取；保留資料因功能測試增加時，重新拍攝基準及候選並核對相同訂單狀態雜湊，不拿不同資料量宣稱效能改善。
