# 官方介面與流程參考

研究日：2026-09-23。使用 AnySearch 查找官方資料；不複製商標、圖像、CSS 或文案。下列「採用」是本專案設計判斷，不表示競品採用相同程式實作。未登入競品付費後台，不能把官網展示當完整實機評測。

| 官方來源 | 可核對的能力／模式 | StallOrder 現況與採用決策 | 不直接移植的部分 |
|---|---|---|---|
| [Toast KDS overview](https://doc.toasttab.com/doc/platformguide/platformKDSOverview.html) | 前後場訂單同步、製作站與出餐站、訂單時間及變更提示 | 區分製作與交付，保留現有 item／order 狀態；工作清單加入篩選與付款、列印問題文字 | 不照搬每種變更都發聲；使用者已要求僅新單聲響 |
| [Square KDS](https://squareup.com/us/en/point-of-sale/restaurants/kitchen-display-system) | 多來源訂單集中於廚房畫面 | 維持同一權威訂單串流與統一清單，不拆成互相矛盾的來源後端 | 不承諾本系統未串接的外送平台 |
| [Lightspeed KDS](https://k-series-support.lightspeedhq.com/hc/en-us/articles/4418209500443-About-the-Lightspeed-Kitchen-Display-System) | 廚房訂單顯示與製作管理 | 保留既有清單／品項／操作三區，在有限畫面提供可捲動區域 | 不新增工作站配對協定 |
| [iCHEF 線上點餐接單說明](https://support.ichefpos.com/?p=6191) | 新訂單提示、接單設定、加點與出單流程 | 接單、製作、付款、列印分開呈現；修改單沿用原有增減項出單機制 | 不把「接受訂單」一律等同付款或列印成功 |
| [Eats365 KDS setup](https://support.eats365pos.com/kitchen-display-system/set-up-and-install-kitchen-display-system) | 確認訂單出現在 KDS；工作站與設備配對有前置條件 | 只顯示帳號與模組允許的操作；列印能力失敗要有處理入口 | 不因只有網路連線就宣稱印表機可用 |
| [GloriaFood](https://www.gloriafood.com/) | 線上點餐與商家接單 app | 顧客保持逐步選餐、購物車、資料確認的流程；保留訪客入口 | 不自動要求入會或接入新金流 |
| [快一點](https://www.quickclick.cc/)、[LINE 點餐](https://www.quickclick.cc/line%E9%BB%9E%E9%A4%90/) | 台灣商家的 LINE／線上點餐入口 | 名詞維持店員、取餐、內用、餐具；會員為可選流程 | 不把其他品牌的會員或推播能力宣稱為已串接 |

## 優先矩陣

| 問題 | 頻率／影響 | 優先 | 對應實作／驗證 |
|---|---|---|---|
| 所有訂單與手機完整卡片同時渲染 | 每次開工作台；基準 74 筆、308 按鈕 | P1 | 5 筆分頁、狀態篩選、105 筆實際資料瀏覽 |
| 製作／付款／列印容易混為同一狀態 | 忙碌時可能誤判下一步 | P1 | 保留 contextual status，另外標示付款與列印問題；不改 command guard |
| 商品批次清單過長，選取影響範圍不清 | 庫存／售完常用 | P1 | 預設 5 筆，全選本頁，跨頁保留明確已選數量 |
| 顧客資料只有 placeholder | 輸入後及長者辨認困難 | P1 | 可見 label、群組標題、阻擋原因關聯與 busy 語意 |
| 商品供應模式直接寫中文 | 非中文商戶無法讀取 | P2 | 全部五種模式及說明接六語系 |
| 後台導覽僅圖示、不知所在模組 | 新手定位成本 | P2 | 現在位置文字與 aria-current，不改角色可見性 |

完整 backlog 與未驗證項目見 [issues-backlog.md](issues-backlog.md)。
