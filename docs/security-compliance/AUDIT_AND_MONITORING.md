# 稽核與監控
新治理異動/敏感揭露與audit_logs、audit_archive_outbox在同一transaction。包含schema/policy、actor/effective actor、organization/entity、requestId、outcome、environment/releaseSha，不放原始details。失敗回滾的實際DB整合測試見integration-tests.json。

既有canonical RPC在同一transaction補完剛插入audit快照，故允許同交易UPDATE；提交後UPDATE/DELETE/TRUNCATE拒絕，service_role無DELETE/TRUNCATE。5項實際pgTAP通過。origin trigger不阻擋logical replication apply；DB owner關閉trigger仍是權限殘餘，這不是WORM。

Ed25519 manifest包含batch/previousDigest/sequence/auditId/digest/count，驗證重複、順序、竄改及已簽批次截斷。SQL rollback可能產生合法sequence gap。沒有外部checkpoint/outbox盤點，不能證明DB owner未隱匿尚未簽章事件。

未配置的archive adapter若被呼叫會明確失敗。本次只有durable outbox與驗章元件，尚未接通archive dispatcher或告警投遞；預定策略為中斷時保留outbox並告警，不因遠端封存中斷停全站下單。必要DB audit失敗仍只回滾對應高風險操作。既有一般拒絕事件best-effort行為未全面改成全站fail closed。

監控清單：案件due/age、缺通知證據、hold到期、刪除BLOCKED/RETRY、archive backlog/lag/簽章失敗、session/MFA/permission異常、DRepoch/writer、重複外部效果。閾值/接收人需核准，不虛構已送告警；log只保留必要trace及allowlisted error code。各資料類別保留期限分開核定。
