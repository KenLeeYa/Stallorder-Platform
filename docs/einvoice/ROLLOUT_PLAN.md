# Rollout Plan

1. **LOCAL_MOCK_READY（目前）**：schema、domain、Mock、UI、RLS 與文件；Production flags 全 OFF。
2. **Contract verification**：選定 primary Provider，取得商家型契約與官方 schema／簽章範例。
3. **SANDBOX_READY**：真實 Sandbox credential、contract tests、webhook security、失敗注入與對帳。
4. **PILOT_READY**：一間授權商家、低流量、人工覆核、回滾與客服 runbook。
5. **PRODUCTION_READY**：安全／法務／稅務核准、監控與 DR 證據、漸進百分比放量。

每階段都需獨立證據；不能用 Mock、CI 或畫面截圖替代 Sandbox/Pilot/Production。任何 Gate=FAIL 都停止推進，不弱化測試或打開正式旗標。

