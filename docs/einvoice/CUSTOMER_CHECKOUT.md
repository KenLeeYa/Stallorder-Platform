# Customer Checkout

## 流程

1. 公開 menu session 由伺服器依 global flags、組織／攤位 policy 及 Provider capabilities 回傳可用選項。
2. 顧客可選雲端、手機條碼、會員載具、統編、捐贈或紙本；未啟用項目完全不顯示。
3. 先建立訂單，再以 tracking token + device identity 將選項寫入同一筆訂單。
4. 伺服器驗證載具／愛心碼、加密敏感值並保存遮罩／雜湊 snapshot。
5. 開票時 orchestrator 讀取訂單與 preference，不信任瀏覽器金額。

## 旗標

結帳 UI 只有在 platform 與 checkout flags 同時開啟才回傳設定。Production flags 目前全為 OFF；本機 Mock 可以測 UI，但不能視為 Edge/Production 已完成。

## 隱私

結帳選項與會員主檔分離；顧客這次輸入不會默默覆寫會員載具。API response、audit metadata 與錯誤訊息不得回傳明文載具、統編憑證或 Provider secret。

