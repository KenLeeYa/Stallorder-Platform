# Docker Desktop 本機預防與復原

本文件適用於 StallOrder 的 Windows 本機環境。健康檢查是唯讀的，不會停止容器、重設 Docker、修改登錄檔或刪除資料。

## 每次開發前

1. 執行 `npm run docker:health`。
2. 確認 Docker Desktop、Engine、WSL 與磁碟空間皆為 `PASS`。
3. 若 `54321` 顯示其他程式占用，先關閉占用程式，或讓本機 Supabase URL 使用能正確連到 Docker listener 的 `localhost`，再測試圖片上傳與訂單流程。
4. 再執行 `npm run local:doctor` 與需要的測試。

## 出現 Engine、AF_UNIX 或 socket 錯誤時

先保留錯誤發生時間與 Docker Desktop 診斷，再依序確認：

1. `docker desktop status`
2. `docker version`
3. `docker info`
4. `wsl --status`
5. Windows 系統碟與 Docker 資料碟仍有足夠空間

單一指令逾時不代表資料損壞；應以 Desktop、Engine 與容器查詢三項結果交叉判斷。

## 需要重裝時的安全順序

只有在相同錯誤可重現、一般重新啟動無效時才進行：

1. 完整關閉 Docker Desktop，確認 Docker 與 WSL 寫入已停止。
2. 備份 Docker 的 `docker_data.vhdx` 到已確認的明確目錄，並確認備份檔大小。
3. 使用 Windows 正常解除安裝，重新開機。
4. 安裝已驗證可用的 Docker Desktop 版本；不要直接用安裝程式覆蓋故障版本。
5. 只有需要保留既有 images/volumes 時才還原備份資料碟。
6. 啟動後重新執行 `npm run docker:health`，再用一個測試容器完成拉取、啟動與移除驗證。

不要先做 Factory Reset、手動刪除 Docker 資料、修改登錄檔或移除 WSL distribution；這些操作會擴大資料遺失範圍。

## 目前本機基準

2026-08-25 驗證時，Docker Desktop 4.86.0、Engine 29.7.2 可正常回應 Desktop、version 與 info。版本本身不是唯一判斷條件，後續仍以健康檢查結果為準。
