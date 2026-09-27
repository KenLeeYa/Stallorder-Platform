# 官方核對紀錄

日期：2026-09-26。以 AnySearch extract 取得官方內容。API v4；沒有因網站範例而呼叫任何收退款端點。擷取原文保留在本次本機 QA artifact，不含憑證。

| 來源 | 本批採用／注意事項 |
| --- | --- |
| [Pay Prerequisites](https://developers-pay.line.me/online/prerequisites) | POST exact JSON bytes；GET path+query；HMAC-SHA256/base64，ChannelId 與 nonce headers。範例 URL 拼接不能直接照抄 |
| [Request](https://developers-pay.line.me/online-api-v4/request-payment) | `/v4/payments/request`；amount/currency/order/packages/redirect；web payment host 依 Sandbox 範例限定；Request 不算付款完成 |
| [Basic payment](https://developers-pay.line.me/online/implement-basic-payment)／[Separated capture](https://developers-pay.line.me/online/implement-capture-separated-payment) | 明確使用 `options.payment.capture: true`；不宣稱可在台灣任意分離 capture |
| [Check](https://developers-pay.line.me/online-api-v4/check-payment-request-status) | `0000/0110/0121/0122/0123` 分別映射；建議至少 20 秒 timeout，輪詢間隔至少 1 秒。transport 本批 25 秒，尚無輪詢 worker |
| [Confirm](https://developers-pay.line.me/online-api-v4/confirm-payment) | 驗證 orderId、transactionId 及 payInfo 合計；Confirm 回應範例沒有 currency，幣別由本次受控 request context 固定為 TWD |
| [Details](https://developers-pay.line.me/online-api-v4/retrieve-payment-details) | 官方表格使用集合參數記法，curl 範例為單一 `transactionId`；本批採單值 wire，Sandbox 尚待實測，不宣稱此差異已消除 |
| [Refund](https://developers-pay.line.me/online-api-v4/refund) | 明確退款額，保留無損 refundTransactionId；不依 omitted amount 觸發全額退款 |
| [MINI App 開發](https://developers.line.biz/en/docs/line-mini-app/develop/develop-overview/) | developing/review/published 為不同內部 Channel；跨 Provider user ID 不可直接合併 |
| [ID Token verify](https://developers.line.biz/en/reference/line-login/#verify-id-token) | 官方 verify 收 raw ID Token+expected client_id；LIFF 未提供自己的 nonce 時不可捏造驗證條件 |
| [永久連結](https://developers.line.biz/en/docs/line-mini-app/develop/permanent-links/) | `https://miniapp.line.me/{liffId}` + page 相對 Endpoint 路徑。分享只允許公開資料 |
| [LIFF SDK](https://developers.line.biz/en/docs/liff/developing-liff-apps/) | client 初始化與版本管理；本批尚未安裝 SDK／啟用 shell，不將舊文件 SDK 範例版本當成當前 lockfile |
| [Rich menu](https://developers.line.biz/en/docs/messaging-api/using-rich-menus/) | 先確認 Manager/API 管理方式，建立／附圖／切預設是不同外部操作；本批無任何 apply |

尚待下一批核對並實作：MINI Service Message token/template API、OA retry semantics、SDK 實際採用版本、WebView payment 返回與當前 Sandbox Query 行為。


2026-09-26 設定補充（AnySearch 取得官方內容）：

- https://developers.line.biz/en/docs/line-mini-app/discover/console-guide/ ：內部 Channel、LIFF ID、tester。
- https://developers.line.biz/en/docs/line-mini-app/develop/develop-overview/ ：台灣建立／認證審核資格。
- https://developers.line.biz/en/tips/2026/06/25/provider-design-basics/ ：Provider 歸屬及使用者識別。
- https://developers-pay.line.me/sandbox ：Sandbox 與取金鑰流程（該全球頁商家登入範例是 TH；台灣改用台灣控制台）。
- https://pay.line.me/portal/tw/customer/faq?categoryId=cashflow ：台灣管理連結金鑰及測試帳號說明。
- https://developers.line.biz/en/docs/liff/release-notes/ ：2.31.0；已固定 npm 版本並使用 pluggable core。
