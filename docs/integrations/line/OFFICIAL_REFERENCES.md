# 官方查核紀錄

2026-09-27，承接2026-09-26，先用AnySearch extract官方來源。固定LIFF 2.31.0、LINE Pay v4。本紀錄不是帳號設定、認證、Sandbox付款或LINE送達證據。

| 官方來源 | 實作採用與限制 |
|---|---|
| [Pay prerequisites](https://developers-pay.line.me/online/prerequisites) | exact POST bytes、GET path+query、HMAC-SHA256/Base64與nonce；不抄錯URL拼接 |
| [Request](https://developers-pay.line.me/online-api-v4/request-payment) | v4 Request不等於付款完成，明確capture true；固定Sandboxhost |
| [Check](https://developers-pay.line.me/online-api-v4/check-payment-request-status) | 0000/0110/0121/0122/0123分開；transport timeout25秒；背景查核60秒起退避 |
| [Confirm](https://developers-pay.line.me/online-api-v4/confirm-payment) | 核對原交易/商家訂單/payInfo合計；TWD由受控requestcontext決定 |
| [Details](https://developers-pay.line.me/online-api-v4/retrieve-payment-details) | 原PAYMENT的refundList；長ID無損、負refundAmount、時間一致；官方範例重複ID/錯日期不當有效資料 |
| [Refund](https://developers-pay.line.me/online-api-v4/refund) | 明確金額、長refundTransactionId；未知不盲重送 |
| [MINI develop overview](https://developers.line.biz/en/docs/line-mini-app/develop/develop-overview/) | developing/review/published內部Channel分離，實際資格/認證仍待控制台 |
| [ID Token verify](https://developers.line.biz/en/reference/line-login/#verify-id-token) | rawIDToken＋正確client_id；不編造LIFF未支援的nonce |
| [Getting user IDs](https://developers.line.biz/en/docs/messaging-api/getting-user-ids/) | Provider身分邊界，不按email/暱稱跨Provider合併 |
| [Permanent links](https://developers.line.biz/en/docs/line-mini-app/develop/permanent-links/) | 真LIFF ID＋相對Endpoint路徑；私人detail仍驗owner |
| [Developing LIFF apps](https://developers.line.biz/en/docs/liff/developing-liff-apps/) | primary/secondary redirect/liff.state與init順序，不先破壞query；真WebView返回待測 |
| [SDK release notes](https://developers.line.biz/en/docs/liff/release-notes/) | 2.31.0固定lockfile，最少pluggable API |
| [Messaging API](https://developers.line.biz/en/reference/messaging-api/) | bot/info destination、Push、quota/consumption、原body HMAC及空events；token用途分離 |
| [Retrying requests](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/) | 相同key/body、24h；409須有原接受識別，不任意換key |
| [Rich menus overview](https://developers.line.biz/en/docs/messaging-api/rich-menus-overview/) | Manager/API/per-user優先順序；API空清單不能證明Manager無選單 |
| [Use rich menus](https://developers.line.biz/en/docs/messaging-api/using-rich-menus/) | 2500x1686官方範例、建/上圖/切default分步，需備份/明確plan |
| [pg_cron](https://github.com/citusdata/pg_cron) | 秒級排程依extension與指定database；本機clone未配置遠端scheduler |

v2採平台普通OA Push，不以MINI Service Message替代sender。OA/Provider/MINI認證是三件事；台灣申請資格、actual Channel/API設定於申請/啟用前再查核。失敗的猜測URL不列成功來源。當前官網樣本、mock transport、真實後台登入，都不等於真收退款或訊息已送達。
