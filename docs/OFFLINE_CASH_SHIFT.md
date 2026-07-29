# 離線現金交班

## 可用範圍

唯一 Offline Leader 只能延續在線時已開啟且已下載快照的班別：

- 建立離線現金訂單
- 記錄核准的現金收入／支出
- 暫時關班 `PROVISIONAL_CLOSE`

離線時不能建立新的正式班別，也不能由多台裝置各自開班。

## 金額計算

```text
預期現金 =
開班金額
+ 現金銷售
+ 現金收入
- 現金支出
- 現金退款
+ 已核准調整
```

Client 顯示本機預估值，但 server 以 canonical CashShift/CashMovement 重新
計算。現金訂單必須綁定已下載且當時為 OPEN 的 shift。若班別在同步前已被
關閉，訂單仍保留，但付款改為 `PENDING_RECONCILIATION` 並建立
`SHIFT_ALREADY_CLOSED` 與 `PAYMENT_RECONCILIATION_REQUIRED`。

每筆 cash event 有獨立 idempotency key。重送不會重複增加金額；重複或總額
不一致會建立衝突，交由店長／財務核對。

## 人工電子付款

允許的人工紀錄為 `MANUAL_LINE_PAY`、`MANUAL_JKOPAY` 與
`OTHER_MANUAL`，同步後保持 `PENDING_RECONCILIATION`。以下操作離線停用：

- LINE Pay／街口／信用卡 API 授權
- provider refund
- 把人工付款標示為 provider-confirmed

風險上限由 Permit 固定，包括單筆、累計、需要顧客聯絡方式與經理核准門檻。
只在門檻要求時收集必要聯絡資料。
