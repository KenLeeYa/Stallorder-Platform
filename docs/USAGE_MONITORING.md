# 用量監控

Trial 採期限／included orders 任一先到的硬限制；付費方案預設採不中斷營業的 soft limit。

| 用量 | 行為 |
| ---: | --- |
| 70% | Dashboard 資訊 |
| 80% | 站內通知 |
| 90% | 緊急通知 |
| 100% | 建議 order package 或升級，正式付費商家預設繼續接單 |
| 110% | Platform Admin follow-up |

監控需比對 usage event、summary、Subscription 帳期與 warning 去重。測試訂單不得出現在任何門檻計算。重建必須保留 request ID、操作者與 audit，且不可改變 Invoice 或歷史訂單。
