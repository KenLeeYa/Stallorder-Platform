# PAYG Billing Timezone

PAYG 現階段只支援 `CALENDAR_MONTH`、anchor day `1`。契約必須保存有效 IANA timezone，遷移時再複製到 Subscription；用量事件、人工關帳與自動關帳皆使用這份 snapshot。

既有 TWD 契約的產品預設是 `Asia/Taipei`。`2026-08-01 00:00:00 Asia/Taipei` 等同 `2026-07-31T16:00:00Z`，邊界前後一毫秒不可落入同一帳期。日後修改攤位營運時區不會改寫已開始的計費月。
