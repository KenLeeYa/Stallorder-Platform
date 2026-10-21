# App 發行政策查核 — 2026-10-01

僅查核官方公開政策，未登入、建立商店／EAS帳號、調整signing或發布binary／OTA。這不是上架资格、實機、Native build或審查成功證明。實際發行前必須再次讀回政策與候選的有效設定，不將本頁永久當最新要求。

| 平台 | 查核日官方要求 | 本輪候選還需的證據 |
|---|---|---|
| Apple | 自2026-04-28，提交App Store Connect的binary須以Xcode26或以上及iOS／iPadOS26等对应SDK建置；官方頁另外列自2026-09-09 iOS／iPadOS deployment target最低iOS13。SDK版本與最低运行OS是不同欄位。 | 本次原生專案实际deployment target、Xcode／SDK、privacy manifest／required reason APIs、簽章、真iOSbinary／裝置與合法帳號資格；Windows Android proof不能代替。來源：[Apple upcoming requirements](https://developer.apple.com/news/upcoming-requirements/)。 |
| Google Play | 自2026-08-31，一般新App與更新須target Android16／API36以上；既有App供較新OS的新使用者搜尋需API35以上。官方有特定類型例外與有條件延長程序，不能視作本App已取得延期。 | 讀實際generated manifest的targetSdkVersion／minSdkVersion／compileSDK、正式stablebuild與依賴、Data Safety／權限／帳號測試資格／signing／真Android裝置；安裝SDK或emulator通過不等於Play審核。來源：[Google Play target API policy](https://support.google.com/googleplay/android-developer/answer/11926878)。 |

查核工具：AnySearch先擷取兩個官方URL，Apple成功；Google回extract_failed，依AGENTS standing fallback改用web工具讀同一官方頁。Apple原始公開摘取在`.superpowers/sdd/2026-10-01-awesome-optimization/apple-store-policy-20261001.json`，Google失敗紀錄在`google-store-policy-20261001.json`。Google成功讀回時間2026-10-01T02:34Z，本文只轉述必要的API／日期，不保存帳號或秘密。

本機已發現既有Android SDK／ADB／emulator／Java與StallOrder_Local_API36 AVD；尚未啟動或驗證binary。後续B5唯一runtime owner要以同DB／App進行實際原生QA，記有效App設定與本頁差異。最終外部checklist交叉引用此页與移植後`docs/mobile/MANUAL_ACTIONS.md`，未選用的store／push／OTA不要求現在申請。
