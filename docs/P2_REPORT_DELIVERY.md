# P2 排程報表寄送

## 架構

- `report_schedules` 保存組織、授權攤位、報告類型、收件人及下一次執行時間。
- `report_deliveries` 保存每次執行結果。`(report_schedule_id, scheduled_for)` 唯一鍵避免同一排程重複寄送。
- `/api/cron/report-deliveries` 只接受 `Authorization: Bearer <CRON_SECRET>`，每次最多領取 20 個到期工作。
- 領取排程與推進 `next_run_at` 在同一資料庫交易內完成；多個 Cron 同時執行時只有一個能成功領取。
- Email 透過 Resend `POST /emails` 寄送，使用 delivery ID 作為 `Idempotency-Key`。
- 寄送內容只包含組織、攤位彙總、付款方式及現金短溢收，不包含顧客姓名、備註、QR、Session 或取餐碼。

## 正式環境設定

```text
CRON_SECRET=<至少 32 bytes 的隨機值>
RESEND_API_KEY=<正式 API key>
REPORT_FROM_EMAIL=StallOrder <reports@verified-domain.example>
REPORT_DELIVERY_MODE=send
```

`vercel.json` 預設每五分鐘呼叫一次 Cron API。使用其他 Hosting 時，可由該平台的排程器呼叫同一路徑並附上相同 Bearer secret。

本機預設 `REPORT_DELIVERY_MODE=simulate`。模擬模式仍會建立報告內容與寄送紀錄，但狀態為 `SIMULATED`，不會宣稱郵件已寄出。production 缺少 Resend 或寄件人設定時會以 `FAILURE` 記錄。

參考：

- [Resend Send Email API](https://resend.com/docs/api-reference/emails/send-email)
- [Vercel Cron 驗證](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
