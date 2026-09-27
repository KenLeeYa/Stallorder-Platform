# 平台顧客會員流程

2026-09-27，v2。合作店不用提供自己的 OA token。

1. 平台 OA/店家 MINI 連結開啟 /mini 或 /mini/store/{identifier}。公開菜單可瀏覽，下單與私人訂單需顧客身份。
2. LIFF raw ID Token 經短效 browser-bound challenge、LINE 官方 verify，再沿原 AuthSession 交換；不信前端 role/lineUserId/店名。既有員工商家 Session 仍顯示「使用 LINE 顧客身分登入」。
3. 明確接受当前條款才建立 Member，記錄版本/時間。交易通知可不勾，沒有自動行銷同意或員工 membership。
4. OA 加好友是另一動作，返回不直接標 FRIEND。後端只信已驗簽 follow/unfollow；UNKNOWN、NOT_FRIEND_OR_BLOCKED 均不保證通知，UI不假稱能區分未加/封鎖。
5. 下單沿原價格/庫存/營業/排程/session/device，同交易固定 owner。本人跨 A/B 店清單可讀；他人 detail 404。
6. 會員頁可改交易通知同意/查看好友/登出。封鎖或解除不把舊單改送另一人。Worker 發送前查 active identity/會員同意/好友。資料刪除沿原 privacy request，付款/交付稽核依原保留政策。

已登入的有效平台會員從原 Web 店面進入自取／外送時，若店家已啟用且到達 cutover，會導往同店 MINI 入口，保留 view／locale 並使用本人隔離草稿。舊條款會員仍導入 MINI，由既有條款畫面引導更新；匿名、公開 menu、非試點與平台 optional 設定錯誤保留原 Web。

已存在的公開 Circuit B 點餐 Session 仍可提交；伺服器驗原 session／device／QR、有效會員及試點邊界，再沿原交易固定 owner 與通知聯絡。已綁某會員的 Session 不可由其他會員或登出後重新使用，既有訂單歸屬也不可變更。Circuit A 訪客仍沿下述 proof 歸戶，沒有改寫 Edge 核心。

## 訪客歸戶

訪客沿原 Web/QR。短取餐號、電話、orderId、QR 圖都不足歸戶。成功建單後，server 驗原 CONSUMED session hash＋装置＋高熵 tracking＋店別，簽發加密 HttpOnly proof，每單 cookie 獨立。

Circuit B 原成功回應附 proof；Circuit A 成功後向同源 /api/public/orders/claim-proof 交換，1.5 秒有界，失敗不重送訂單。原 tracker 只有對應 proof 且 pilot/cutover 可用才顯示歸戶入口。新會員確認後再驗原 session/device/proof、無舊 OA 綁定、唯一 owner，寫關聯與 audit。

Proof 24 小時、Strict/HttpOnly/HTTPS Secure；無原 session/device 關聯仍拒絕。兩店 cookies不互蓋；跨店 session、換裝置、他人 proof、撤銷身份均拒絕。既有 owner 不因重新登入移給另一人。

## 私有頁與返回

Endpoint 固定 /mini；detail 只含 UUID仍查 Session/ownership。原 tracking、return state、raw Token 不進永久連結。分享僅白名單公開店面/view/locale。API private/no-store；PNG media 是獨立能力票據，不是 JSON/交付授權。

真人 LINE 帳號切換、WebView 關閉重開、Safari/Chrome返回、無 Session Pay回跳須 G 組實機驗證。合成 Session 不替代這些證據。既有匿名草稿不作無證據的跨會員自動合併；MINI會員草稿隔離及合法訪客歸戶是不同責任。


## 登入前購物車轉入

只接受本次新建、仍 ACTIVE 的原訪客 Session，原顧客按「用 LINE 繼續此購物車」才建立 10 分鐘交接憑證。草稿在 sessionStorage 加密保存，HttpOnly proof 綁相同環境、Provider、店家、QR、裝置、履約方式及草稿；不將姓名／電話／地址放在 URL。儲存空間不可用時留在原訪客流程，不清掉原購物車。

LINE 登入並接受條款後，在同店明確確認匯入；已存在的會員草稿在確認前保持原樣。匯入會取代當前草稿，介面會先說明；價格、庫存、必選註記與時段交回原 checkout 再驗證。既有會員的 Session 從發行起即綁本人，登出也不能再當訪客轉給另一人。歸戶與會員／LINE 身分撤銷有交易鎖；跨店、換裝置、過期／已消耗 Session、不同會員重放均拒絕。

此功能不自動認領瀏覽器內來源不明的舊草稿。真 LINE 跨 App 返回後的儲存存續仍屬 G 組裝置驗收，不能以本機合成登入代替。
