# PAYG Manual Actions

下列項目需要人工作業，不可由程式推測：

- 稅務處理、稅率、jurisdiction、cap tax basis、捨入及稅務文件需求。
- 自動關帳延遲、第一批 pilot 名單及每階段 flag 核准。
- 已付款／已開稅務文件之折抵文件處理。
- Staging 與 Production 的 migration、audit、備份／PITR、DR 及 rollout receipt。
- Foodpanda、Uber Eats 或 payment provider 的正式契約、credentials、scope 與 webhook 驗收。

未完成上述項目時，PAYG v1 保持 `UNCONFIGURED`，付款、外送及自動收費介面保持隱藏／OFF。
