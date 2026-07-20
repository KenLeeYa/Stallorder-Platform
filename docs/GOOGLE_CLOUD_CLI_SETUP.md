# Google Cloud CLI 設定

## 已驗證環境

- 作業系統：Windows
- Google Cloud CLI：`576.0.0`
- 安裝來源：Google 官方 Cloud SDK 套件
- 執行檔：`%LOCALAPPDATA%\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd`
- 使用者 PATH 已加入 Cloud SDK `bin`；新開 PowerShell 後可直接執行 `gcloud`。

驗證指令：

```powershell
gcloud --version
gcloud auth list --filter=status:ACTIVE --format="value(account)"
gcloud config get-value project
```

不得執行會輸出 access token 或 refresh token 的指令，也不得把 `%APPDATA%\gcloud` 或 ADC 檔案放入 Repository。

## 互動式授權

```powershell
gcloud auth login --update-adc
```

瀏覽器登入及 MFA 必須由帳號持有人完成。StallOrder 不要求、保存或自動填入 Google 密碼。

## 目前結果

- 已驗證帳號：`ada76145@gmail.com`
- 已選專案：`stallorder-identity`
- 專案顯示名稱：`StallOrder Identity`
- 未自動綁定或變更 Billing Account。

若 `gcloud` 在既有終端機找不到，請重開 PowerShell；不要重複安裝。
