# 人工帳務操作手冊

## 角色

- Organization Owner：選擇方案、檢視 Invoice／用量、提交付款資料。
- Finance Viewer：唯讀帳務與用量，不可送出或審核付款。
- Platform Admin：建立 Invoice、審核付款、控制訂閱、指派用量包、重建用量。
- Staff／Kitchen／Anonymous：無帳務資料權限。

## 新訂閱啟用

1. 商家由 `/merchant/billing` 選擇方案並送出申請。
2. Platform Admin 在 `/admin/billing` 檢查組織、方案版本、週期與金額。
3. Admin 建立 Invoice；伺服器由 `plan_versions` 和受控 line item 重算總額。
4. 商家以銀行轉帳、現金、人工 LINE Pay 或其他核准方式付款。
5. 商家提交金額、付款方式、收款時間及必要的部分識別資料；不得提交完整帳號或密碼。
6. Admin 對照實際入帳後逐筆驗證或拒絕。
7. 累計已驗證金額達 Invoice 總額時，系統在同一交易將 Invoice 設為 `PAID`、Subscription 設為 `ACTIVE`，並寫入 audit 與 notification。

## 續約

- Admin 建立下一帳期 Invoice，保持既有 `plan_version_id`，除非有明確方案變更申請。
- 付款驗證後更新 billing period；過早續約由服務拒絕。
- 年繳與月繳金額均取自目前訂閱鎖定的 Plan Version。

## 停權與恢復

- 停權前確認組織、未付 Invoice、原因與操作者。
- `SUSPENDED` 會阻擋新的公開 order session 與公開訂單，但商家仍可登入、讀歷史資料及帳務頁。
- 恢復前確認付款或人工核准依據；Admin 執行 reactivation 後寫入時間、before/after 與通知。
- 不以刪除資料作為停權手段。

## 用量與額外項目

- 「重建用量」只從 append-only `usage_events` 重算指定帳期，不刪除歷史事件。
- Trial 到 100 筆完成訂單時為硬限制。
- 付費方案超過 included orders 時持續接單並建立警示；Admin 可指派 order package。
- 額外攤位須先核准，再由受鎖定的建立流程檢查 `max_stalls`。

## 對帳異常

- 金額不足：Invoice 保持 `OPEN`，只增加 `amount_paid`。
- 金額、幣別或 Invoice 不符：拒絕該筆付款並記錄不含敏感資料的原因。
- 重複提交：使用組織範圍 idempotency key 回傳既有紀錄。
- 誤驗證：不得直接改資料庫；建立受稽核的更正操作或新 forward migration。
- 服務錯誤：保留 Invoice 與付款原狀，依 request ID 查詢 structured logs。

## 每日檢查

- 待驗證付款與逾期 Invoice。
- Trial 即將到期與已停權組織。
- 80／90／100／110% 用量警示。
- notification outbox 失敗與重試狀態。
- audit event 是否包含 actor、request ID、before/after。

