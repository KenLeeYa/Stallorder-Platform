# 商家開店設定精靈

## 進入條件

Platform Admin 核准申請後才建立 `merchant_setup_progress`。核准不代表開放營業；登入解析會將該 Organization Owner 導向 `/merchant/setup?organizationId=...`。

## 八個步驟

1. 商家資料：名稱、聯絡資料與必要資訊已存在。
2. 攤位資料：名稱、地址、營業位置與營運設定。
3. 商品目錄：至少一項啟用且分類有效的商品。
4. 付款方式：至少一個啟用選項。
5. 團隊：邀請人員或明確確認暫不邀請。
6. QR 預覽：使用 authenticated 唯讀菜單預覽，不建立 public session 或訂單；QR 保持 `PAUSED`。
7. 測試訂單：建立 `MERCHANT_SETUP_TEST`、`is_test=true`、`WAITING_CONFIRMATION` 訂單，由既有店員流程完成確認、製作、Ready 與 Completed。
8. 正式開放：Owner 二次確認後執行 Go-live transaction。

## 三個硬性閘門

```text
送出申請 -> 只建立 merchant_application
核准申請 -> QR PAUSED + Stall CLOSED
測試單 COMPLETED + Owner 明確確認 -> QR ACTIVE + Stall OPEN
```

測試單完成只解鎖按鈕，不會自動開放接單。

## Go-live transaction

交易鎖定 setup row，重新驗證六個準備步驟、可用商品、付款方式、`is_test=true` 且 `COMPLETED` 的連結訂單、Trial／Active Subscription、PAUSED QR、CLOSED Stall，才同時更新：

```text
qr_codes.state = ACTIVE
stalls.ordering_state = OPEN
stalls.business_status = OPEN
stalls.ordering_enabled = true
merchant_setup_progress.go_live_completed = true
```

並建立 applicant notification 與 `MERCHANT_GO_LIVE` audit。

## 商用與報表整合

- 測試單不建立 `BILLABLE_ORDER_COMPLETED`，不消耗 Trial／package 額度。
- 測試單預設不進商品、每小時、取消、付款與 daily stall summary。
- 測試單不建立實際 Payment，避免現金交班與對帳污染。
- Go-live 後正式訂單恢復既有 Trial hard limit、paid soft limit、Invoice 與 suspension 規則。
