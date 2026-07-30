# 付款供應商備援

日期：2026-07-29

## 狀態模型

LINE Pay 與街口支付使用下列營運狀態：

```text
AVAILABLE
DEGRADED
UNAVAILABLE
MAINTENANCE
UNKNOWN
```

狀態解析規則：

- 功能旗標未開啟：`MAINTENANCE`
- 功能已開啟且有有效的明確營運狀態：使用該狀態
- 功能已開啟但未取得可信狀態：`UNKNOWN`
- 不因為環境變數或憑證存在，就把供應商判定為健康

目前狀態由 server-only 環境變數提供：

```text
LINE_PAY_OPERATIONAL_STATUS
JKOPAY_OPERATIONAL_STATUS
```

不得使用 `NEXT_PUBLIC_` 前綴，也不得記錄供應商憑證。正式 Adapter 尚未啟用
前，預設值維持 `MAINTENANCE`。

## 選擇規則

只有 `AVAILABLE` 的線上供應商可以建立新的線上付款流程。

| LINE Pay | 街口支付 | 可用線上付款 | 必須保留 |
| --- | --- | --- | --- |
| `AVAILABLE` | 非 `AVAILABLE` | LINE Pay | 現金、人工付款 |
| 非 `AVAILABLE` | `AVAILABLE` | 街口支付 | 現金、人工付款 |
| `AVAILABLE` | `AVAILABLE` | LINE Pay、街口支付 | 現金、人工付款 |
| 皆非 `AVAILABLE` | 皆非 `AVAILABLE` | 無 | 現金、人工付款 |

兩個供應商都不可用時，不得阻止建立訂單。系統改由現金或人工付款完成後續
對帳，但人工付款不得標記為 provider-confirmed。

## 線上付款不變量

- 每張訂單同時最多一筆 active online Payment Intent。
- Browser redirect 不是付款成功證據。
- Callback 必須驗證 signature、amount、currency 與 provider event id。
- Callback 必須解析目前 active backend，並使用 event idempotency。
- 結果不確定時查詢供應商，不得直接宣告成功。
- 付款失敗不得讓訂單建立、確認或出餐流程回滾。

## 健康狀態限制

本階段沒有對 LINE Pay 或街口支付執行真實交易探針。`AVAILABLE` 必須由受控
營運流程或未來 Adapter health checker 寫入；若沒有可信訊號，應維持
`UNKNOWN` 或 `MAINTENANCE`。

## 告警

- `AVAILABLE` 轉為 `DEGRADED`／`UNAVAILABLE`：通知值班人員並確認付款 UI。
- 兩個線上供應商皆不可用：顯示現金／人工付款指引，不關閉接單。
- Provider callback 重複、簽章錯誤或金額不符：拒絕處理並建立安全告警。
- 人工付款待對帳超過營業日截止時間：建立付款差異告警。

