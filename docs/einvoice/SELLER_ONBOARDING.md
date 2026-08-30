# Seller Onboarding

商家設定精靈共 13 步：

1. 賣方資料
2. 選擇 Provider
3. Provider 帳號 reference
4. 讀取 capabilities
5. 建立不可變 policy version
6. 選擇顧客結帳項目
7. Mock／Sandbox 連線測試
8. 測試開立
9. 測試查詢
10. 測試作廢
11. 測試折讓
12. Production checklist
13. 正式啟用

本次只有本機 Mock 步驟可以完成；畫面必須持續顯示 `TEST / NOT A LEGAL INVOICE`。步驟 12、13 不因前端點擊而解鎖。

每個組織自行擁有 seller profile 與 connection；Provider secret 必須放在正式 secret store，本資料庫只保存 reference、遮罩帳號、狀態與驗證時間。

