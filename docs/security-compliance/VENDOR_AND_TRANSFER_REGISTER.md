# 委託供應商與跨境
| 服務 | 用途 | 地區/契約與狀態 |
|---|---|---|
| Vercel | Next.js/functions/logs | 文件hnd1；實際logs/次處理者/DPA待核；本次唯讀project/deployment |
| Supabase | DB/Auth/Storage/Edge/backup | 新DR文件記兩個Tokyo專案，非跨區DR；實際地區/DPA/backup待核，零遠端migration |
| Cloudflare | DNS/WAF/Turnstile/Access | 地區、log保留、身份與跨境條款待核；零設定修改 |
| Google/LINE/Apple | 聯合登入 | subject/LINE scope分隔；條款/欄位/地區待核；無自動連結或MFA啟用 |
| LINE/通知 | 履約與獨立opt-in行銷 | purpose、委託、撤回、已送資料清除協議；零發送 |
| PSP/收單/電子發票 | 商家直接收款、對帳/稅務 | 資格、sandbox/live、DPA及留存待核；平台不經手款項 |
| 外送 | 核准店面與明確交易共享 | partner資格、projection及重試契約；既有adapter/flags |
| Star/現場裝置 | 必要列印 | 韌體/LAN/紙本範圍；contract/mock非實機 |
| 獨立archive/KMS | 證據封存/金鑰 | 獨立帳戶/權限/地區/保留/readback尚未配置 |
| AI/analytics（啟用才適用） | 既有核准功能 | 資料訓練、保留/地區/工具範圍待核；沒有新增AI產品或傳送本次業務資料 |

每筆必填：法律名稱、契約版本/日期、owner、目的/資料/當事人、處理/備份地區、次處理者、權限、保留/刪除API、事故SLA、可攜/終止、跨境基礎、DPA/核准/reviewAt。未知為UNKNOWN，官網承諾不是已簽契約。統一追蹤EXTERNAL_SETUP_CHECKLIST。
