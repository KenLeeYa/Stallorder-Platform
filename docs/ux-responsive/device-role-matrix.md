# 角色與裝置設計方案（方案 B 已核准，2026-09-30）

## 架構比較

| 方案 | 成本 | 優點 | 風險 | 結論 |
|---|---|---|---|---|
| A 單頁響應式＋元件組合 | 小到中 | 大量沿用現有CSS；適合單純頁面密度改善 | Staff/KDS/POS特定任務繼續堆在巨型presentation，狀態生命週期差異難治理 | 用於單一元件內，不當全專案策略 |
| **B 共用資料／任務模型＋角色介面** | 中，分片漸進 | 沿用現有controller、API、auth；依角色選清單、三欄、sheet，不分叉交易 | 共享元件影響多角色，需同批回歸；不能為抽象而重寫已正常頁面 | **推薦** |
| C 三套獨立手機／平板／桌機 | 高且持續 | 可自由設計各套頁面 | 付款、庫存、權限、錯誤恢復易分叉；三倍回歸與漂移 | 不採用 |

方案 B 不是新建全站架構：優先補齊既有 `ExperienceDialog`、Navigation、Staff/QR controller，只有實際兩個以上消費面相同的行為才抽取共用。route、DTO、交易服務維持現狀。

## 斷點決策

Prompt 的640/1024是初始參考；現況大量以768切換，直接全域替換會破壞已驗證工作流。提案採**元件內容寬度**決定布局，以下是驗證起点：

- 320–767：手機式任務檢視。不是判斷硬體；窄桌機、200% zoom同樣可用。
- 768–1023：觸控工作台。Staff保留使用者指定三欄預設；提供「展開訂單明細」的專注檢視，以可恢復返回代替縮字。訂單編號／狀態／總額不截斷。長備註可在詳情完整閱讀。
- ≥1024：Staff三欄；POS/menu分欄；管理表格依實際欄位所需寬度切換，不強制1024全部表格化。
- ≥1280：Admin可搜尋側欄；仍保留鍵盤／觸控可用性；Merchant operational header保留完整工具列。
- 顧客與POS的固定340/360px側欄在768直向可能過窄：先驗證商品與必選項最小閱讀寬，容納不了則改單任務pane；不是縮小到不可點。這不影響Staff訂單三欄約定。
- 不以user-agent唯一判斷；pointer coarse可增加密度餘裕，不授予／撤銷功能。

**三欄取捨明示：**Prompt範例允許平板直向雙區；本提案保留先前使用者明確偏好的三欄。若真機／200%顯示需要雙區，應先展示證據與替代版再決策，不能偷偷更改預設。

## 各角色布局

| 任務 | 手機／窄視窗 | 平板直向／橫向 | 桌機 | 不可變契約 |
|---|---|---|---|---|
| 顧客菜單 | 單欄商品、分類橫向條；底部份數＋總額＋購物車 | 直向依容納單pane，橫向商品＋購物車 | 商品＋固定摘要 | 訪客可用、server價格庫存 |
| 客製 | 可讀全高sheet，必選與差額明示，底部加入 | 有界modal，內容獨立scroll | 同一元件，可鍵盤操作 | 必選／最大數量由server複核 |
| 結帳／追蹤 | 明確金額、下一步、付款未知不重付 | 同單摘要與狀態分組 | 適度分欄，不拉長輸入框 | 已付款≠已完成製作≠已交付 |
| Staff | 主要圖示＋所有功能；清單→明細sheet；主動作48px以上 | 全圖示列＋三欄滿版；窄直向可主動展開明細 | 全功能列＋三欄，搜尋與篩選一列 | 不隱藏唯一動作、不增權 |
| POS | 商品／本次訂單task切換；底部總額；找零醒目 | 商品＋訂單雙區（可讀性不達時單pane切換） | 高密度商品與訂單，實收短輸入 | 同controller、草稿門市隔離、同冪等鍵 |
| KDS | 清楚待辦卡／單筆detail，大CTA | 訂單模式三欄；品項2–3欄依內容 | 多欄＋工作站／排序 | 無顧客電話與付款金額；原製作節點 |
| Merchant | 營業／售罄／門市高頻圖示，其他放所有功能 | operational header完整圖示；設定列表與editor依寬度 | 完整功能；管理資訊架構可搜尋 | 不重複角色切換或失去返回來源 |
| Admin | 主要應急動作＋全功能入口；寬表轉重點卡 | 壓縮導覽／抽屜，低風險完整可到達 | 可搜尋側欄、麵包屑、列表詳情 | step-up、理由、audit沿用server |

## B2 Admin local verification

在隔離 3026／56822 本機候選，申請審核與方案版本於 320–1440px 以可讀卡片顯示；申請審核入口保持在內容容器內，完整資料可由鍵盤展開，保留原篩選與詳情返回。寬版比較表仍是局部捲動資料檢視，主要審核入口留在卡片。電子發票連線於手機以 Provider／環境／狀態／商家數的 key/value 卡呈現，仍為唯讀且 Production Issue 為 OFF。低角色直接讀取三個 Admin 網址與提交審核 API 均依既有伺服器邊界回 404；拒絕寫入留下 `AUTHORIZATION_DENIED` 稽核，申請資料與成功操作稽核不變。B2 精確 RED／GREEN、環境與未執行項目見 `.superpowers/sdd/2026-09-30-responsive-management-verification/task-2-report.md`；B3 合併驗收與真實裝置／Provider 驗證尚待執行。

Staff工具順序保留：取餐碼右方為平台QR交付圖示（功能可用時）；搜尋鄰近產能；手機常用角色切換、聲音、喚醒、列印在SSE左方；明暗與訂單提醒放全功能。純店員沒有角色切換權限時不補假按鈕。平板／桌機沒有「所有功能」取代工具列；工具條允許局部橫滑，不允許主操作必須橫滑才能到達。

## 第一個端到端切片

先在隔離本機固定fixture驗證：顧客390手機選必選／多選→建立一筆訂單→Staff1024平板接單→KDS更新→顧客追蹤→desktop讀回同單；同鍵重送仍只有一筆。再驗售罄、斷線、舊快照、權限負例。不是先把所有頁面換樣式後才測交易。

## B1 Merchant local verification

2026-09-30 isolated 3026 production-mode browser: 390px function directory remains available; 768/820/1024/1440px show every authorized function as labeled keyboard-reachable icons without a directory button. Phone product editor traps Tab, keeps one unsaved catalog selection through 390→1024→390, closes a child on Escape without closing the parent, and returns focus to its trigger. Saved TODAY sold-out state reads back after reload and rejects a previously issued customer cart with `PRODUCT_UNAVAILABLE`; a logged-in pure Staff identity receives HTTP 403 for direct Merchant availability and `MANAGE_STALL` operations PATCH, with a request-correlated DENIED audit and unchanged stall fields.

Selected authorized `stallId` and custom 2026-09-01–30 period survive report Apply and export. The actual downloaded CSV contained dated rows only for `AMING-01`; the unfiltered SINGLE_STALL default still submits no explicit stall ID. Phone import preview displayed the valid row, labeled invalid row 3, and a visible submit action. A normal owner switch from stall A with an unsaved catalog selection and visible copy-link hint through the authorized picker to a second active stall displayed B's identity/product, no A-only draft or hint, and unchanged B product rows. LINE setup displayed its actual unverified integration state; the local payments module was not advertised and its route returned 404 under the current capability gate, so no live payment claim follows. Physical device, live LINE/Pay, and combined B3 verification remain open.
