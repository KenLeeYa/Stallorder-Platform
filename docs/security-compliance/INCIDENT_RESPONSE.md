# 個資與安全事故
沿用[既有應變](../INCIDENT_RESPONSE.md)、[DR事故](../incidents/2026-09-12-dr-production-outage.md)、[Production回復](../PRODUCTION_ROLLBACK.md)。本文件不授權切writer或對外通知。

DETECTED→TRIAGED→CONTAINING→INVESTIGATING→RECOVERING→CLOSED。獨立通報狀態ASSESSING/DRAFT/SUBMITTED/NOT_REQUIRED。知悉時間可因證據提前，不得往後挪；facts加密，affectedCount及UNKNOWN/ESTIMATE/VERIFIED分離，版本衝突拒絕。

適用數位產業且危害正常營運或大量權益才自知悉起72小時；適用/影響未知不能NOT_REQUIRED。SUBMITTED需真實證據，CLOSED需完成通報判斷。此演算法只涵蓋上述法定觸發；客戶契約或他國較短期限另登錄，不能以72小時概括。

指定incident commander→保存時間線/原始證據雜湊及保管鏈→確認Primary登入/訂單→限縮權限/停止受影響效果→維持帳務與單writer→調查/補報/通知草稿→隔離復原/negative tests→核准結案與改善追蹤。勿等待調查全部完成才開始計時。

通知草稿：事件識別、知悉/發生時間可信度、資料類別/估計範圍、影響、措施、當事人可做事項、窗口、未確定事項、下一次補報時間、法源/契約。不可附raw token/完整名單或未證實歸因。本次外部發送為0。

UNASSIGNED責任：事故指揮、技術、個資/法律、商家溝通、會計對帳與對外核准。教育訓練/演練只記真實日期、人員、情境、結果，不產生虛假出席紀錄。
