# LINE 本機介面與模擬測試

入口： http://127.0.0.1:3026/local-qa/line ，使用本機測試帳號登入。

使用既有 MINI 視覺樣式，提供店家／我的訂單／會員／協助／OA 模擬頁面。建立模擬單後可逐步模擬店員確認、餐點準備、完成與取餐，再查看 OA 訊息卡及圖文選單。通知選項只影響此頁記憶體資料；重新整理或重設清空。示意取餐號碼不是有效交付 QR。

只有明確本機環境（APP_ENV=local、無 Vercel 環境且 PostgreSQL 為 loopback），或本次受限 QA（APP_ENV=test、VERCEL_ENV=preview、RESPONSIVE_QA_RUN=true、APP_BASE_URL 固定 http://127.0.0.1:3026、資料庫固定 PostgreSQL 127.0.0.1:56822/postgres）開放；非空 VERCEL 拒絕，仍要求登入。「協助」為 FAQ，並非真人客服。它與真正 /mini、LINE Login、Pay／Webhook／OA 發送設定分離，不建立訂單、不發送外部訊息、不接收付款。使用者本輪選擇先測本機介面與模擬流程。先前到期 Preview 不重新啟用。本頁成功不代表真 LINE／Sandbox／實機掃碼通過。
