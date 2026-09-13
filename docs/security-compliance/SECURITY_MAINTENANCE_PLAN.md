# 安全維護計畫
版本2026-09-13；提出待核定計畫，不虛構人員、訓練或稽核完成紀錄。

公司指派個資/資安主責、系統owner、事故指揮、會計/資料owner、供應商窗口及替代人。控制分為applicability/code/verification/rollout，不能單一「完成」掩蓋外部未設定。

日常檢視登入授權、請求期限、job失敗、封存积壓、backup/DR writer。Release固定commit/tree、秘密與依賴掃描、CI/Preview、role隔離、migration/DR、回復候選及Production前後回讀。Gate FAIL不降低測試或改旗標繞過。

定期核准權限/供應商review、資料清冊/保留、弱點修補、restore/事故演練、訓練及稽核。頻率、預算/人員依風險與法規門檻核定；新增敏感資料、AI、跨境、payment或裝置先評估。

證據模板：日期/人員、範圍版本、環境、預期/實際、PASS/FAIL/SKIPPED、異常原因、措施、owner/reviewAt。只保留必要證據，不以安全為由永久保存全部raw資料。
