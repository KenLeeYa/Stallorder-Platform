# 無障礙與裝置驗證

範圍：本輪修改的店員工作台、共用商品、商家儀表板、平台帳務、公開 Menu，以及供應設定視窗。目標 WCAG 2.2 AA；本報告不是全站認證。使用真實本機資料及授權登入，沒有排除 axe 規則或隱藏問題節點。

## 自動掃描

`UI_UX_QA=true`、`PLAYWRIGHT_APP_URL=http://127.0.0.1:3023`、`PLAYWRIGHT_REUSE_EXISTING_SERVER=true` 下執行：

```powershell
npx playwright test e2e/ui-ux-accessibility-local.spec.ts --workers=1
```

axe-core 4.13.0，tags `wcag2a/wcag2aa/wcag21aa/wcag22aa`。五頁各掃描 390px 明色、1280px 暗色，共十種頁面狀態；另掃六語供應視窗。帳務的低頻設定先展開，避免收合隱藏問題。最新十種狀態與六語 dialog 均為零個自動規則違規；結果檔位於本輪 `final-browser-evidence` 的 `axe-results.json`。

| 本輪掃描發現 | 原因 | 修正／結果 |
|---|---|---|
| PWA 連線提示 `aria-prohibited-attr` | 一般 span 使用 aria-label，沒有允許的語意角色 | 使用 status 語意；五頁複測通過 |
| 手機紅色異常卡次要文字對比約 4.37:1 | text-stone-500 在淡紅背景不足一般文字 AA | 對應資訊改 stone-600；複測通過 |
| 暗色選取訂單對比約 1.85:1 | 明色選取背景與暗色文字規則混用 | 暗色選取態集中 CSS 配對；複測通過 |
| 暗色平台設定對比約 3.64:1 | 半透明背景沒有得到既有暗色配對 | 改為既有完整語意背景；展開設定複測通過 |

初次測試切換主題立即掃描會擷取過渡色；測試現在等有限 CSS transition 完成，不關閉對比規則，也不等待無限 loading animation。

## 鍵盤、焦點與觸控

- 六語供應設定：連續 Tab 保持於 dialog、Escape 關閉並返回原按鈕；不以中文名稱假定其他語言。
- 儲存中：同步重入鎖防止連點；焦點移到仍存在的 dialog，Escape 不讓使用者遺失待處理狀態。429、500、斷線保留日期，失敗後可重試或關閉。
- 手機巢狀視窗：native cancel 在按鍵事件後關閉內層，商品導覽視窗保留；避免內層卸載後父層把同一次 Escape 當自己的關閉。
- 訂單狀態篩選以 Enter 操作，aria-pressed；分頁計數可朗讀。付款、列印、來源保留文字，不只色點。
- 顧客稱呼、電話、地址與備註有可見 label；結帳錯誤連到具體欄位，必填條件仍遵循既有 checkout controller。
- 本輪主要按鈕 min-height 44px；長者模式的資料、備註、金額同步放大，桌面實測資料文字至少 18px。沒有把 checkbox 改成滑動開關。

## 響應式

成對截圖覆蓋 320、360、390、768、1024、1280、1440px。互動案例另外檢查三欄左列表內部及整頁沒有水平溢出、長者暗色可操作。200% 使用 CSS zoom 進行自動回歸；這不等同原生瀏覽器縮放或 iPad 真機。

## 仍需驗證的範圍

| 缺口 | 原因／後續驗收 |
|---|---|
| NVDA、VoiceOver、TalkBack 實際朗讀 | 此環境沒有已連接的螢幕閱讀器操作證據；須驗標題、動態 status 朗讀頻率、欄位錯誤和 nested dialog |
| 原生 200% zoom、forced-colors | 本輪 CSS zoom／axe 只能提供部分證據；須實際作業系統及瀏覽器檢查 |
| Android／iPad 真機觸控、橫直向、鎖屏通知 | 桌面 Chromium viewport 不是實機；通知音由 OS/瀏覽器及前景播放分別控制 |
| 其餘頁面及所有展開狀態 | 路由盤點 111 頁；本輪沒有宣稱每頁每個 dialog 均符合 AA |

以上未測項沒有列為 passed。後續驗收及回復方式見 release-and-rollback-plan.md。
