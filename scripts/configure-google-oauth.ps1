[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("production", "staging", "local")]
  [string]$Target,
  [switch]$Apply,
  [switch]$Rollback
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$targets = @{
  production = @{
    ProjectRef = "eyuctbnlvnbnivwasvqr"
    SiteUrl = "https://app.qidaigo.com"
    RedirectUrls = @(
      "https://app.qidaigo.com/auth/callback",
      "https://app.qidaigo.com/invite/claim"
    )
  }
  staging = @{
    ProjectRef = "daeqwtpaxcebmtwxqdkj"
    SiteUrl = "https://staging.qidaigo.com"
    RedirectUrls = @(
      "https://staging.qidaigo.com/auth/callback",
      "https://staging.qidaigo.com/invite/claim"
    )
  }
  local = @{
    SiteUrl = "http://localhost:3000"
    RedirectUrls = @(
      "http://localhost:3000/auth/callback",
      "http://127.0.0.1:3000/auth/callback"
    )
  }
}

function ConvertFrom-SecureValue {
  param([Security.SecureString]$Value)
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Set-DotEnvValue {
  param([string]$Path, [string]$Name, [string]$Value)
  if ($Value.Contains("`r") -or $Value.Contains("`n") -or $Value.Contains('"')) {
    throw "Invalid value for $Name."
  }
  $lines = if (Test-Path -LiteralPath $Path) { [Collections.Generic.List[string]](Get-Content -LiteralPath $Path) } else { [Collections.Generic.List[string]]::new() }
  $replacement = "$Name=`"$Value`""
  $index = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^$([regex]::Escape($Name))=") { $index = $i; break }
  }
  if ($index -ge 0) { $lines[$index] = $replacement } else { $lines.Add($replacement) }
  [IO.File]::WriteAllLines($Path, $lines, [Text.UTF8Encoding]::new($false))
}

function Remove-DotEnvValue {
  param([string]$Path, [string]$Name)
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $lines = Get-Content -LiteralPath $Path | Where-Object { $_ -notmatch "^$([regex]::Escape($Name))=" }
  [IO.File]::WriteAllLines($Path, $lines, [Text.UTF8Encoding]::new($false))
}

$configuration = $targets[$Target]
Write-Host "Target: $Target"
Write-Host "Site URL: $($configuration.SiteUrl)"
Write-Host "Redirect URLs:"
$configuration.RedirectUrls | ForEach-Object { Write-Host "- $_" }

if (-not $Apply -and -not $Rollback) {
  Write-Host "Dry run only. Re-run with -Apply to configure or -Rollback to disable/remove local configuration."
  exit 0
}

if ($Target -eq "local" -and $Rollback) {
  $envPath = Join-Path (Get-Location) ".env"
  foreach ($name in @(
    "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID",
    "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET",
    "NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED"
  )) {
    Remove-DotEnvValue -Path $envPath -Name $name
  }
  Write-Host "Local Google OAuth values removed from the ignored .env file."
  exit 0
}

$accessToken = $env:SUPABASE_ACCESS_TOKEN
$accessTokenSecure = $null
if ($Target -ne "local" -and [string]::IsNullOrWhiteSpace($accessToken)) {
  $accessTokenSecure = Read-Host "Supabase access token" -AsSecureString
  $accessToken = ConvertFrom-SecureValue $accessTokenSecure
}

try {
  if ($Rollback) {
    $headers = @{ Authorization = "Bearer $accessToken"; "Content-Type" = "application/json" }
    $body = @{ external_google_enabled = $false } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Patch -Uri "https://api.supabase.com/v1/projects/$($configuration.ProjectRef)/config/auth" -Headers $headers -Body $body | Out-Null
    Write-Host "Google Provider disabled. Existing credentials were not printed or deleted."
    exit 0
  }

  $clientId = (Read-Host "Google OAuth Client ID").Trim()
  if ($clientId -notmatch "^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$") {
    throw "Client ID is not a Google OAuth Web Client ID."
  }
  $clientSecretSecure = Read-Host "Google OAuth Client Secret" -AsSecureString
  $clientSecret = ConvertFrom-SecureValue $clientSecretSecure
  if ($clientSecret -notmatch "^[A-Za-z0-9_-]{20,}$") { throw "Client Secret format is invalid." }

  if ($Target -eq "local") {
    $envPath = Join-Path (Get-Location) ".env"
    Set-DotEnvValue -Path $envPath -Name "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID" -Value $clientId
    Set-DotEnvValue -Path $envPath -Name "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET" -Value $clientSecret
    Set-DotEnvValue -Path $envPath -Name "NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED" -Value "true"
    Write-Host "Local Google OAuth configured in the ignored .env file."
  } else {
    $headers = @{ Authorization = "Bearer $accessToken"; "Content-Type" = "application/json" }
    $uri = "https://api.supabase.com/v1/projects/$($configuration.ProjectRef)/config/auth"
    $current = Invoke-RestMethod -Method Get -Uri $uri -Headers $headers
    if ($current.external_google_enabled -and $current.external_google_client_id -and $current.external_google_client_id -ne $clientId) {
      throw "A different Google Client ID is already enabled. Review and rotate it manually before applying."
    }
    $existingRedirects = @($current.uri_allow_list -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $redirects = @($existingRedirects + $configuration.RedirectUrls | Select-Object -Unique)
    $body = @{
      external_google_enabled = $true
      external_google_client_id = $clientId
      external_google_secret = $clientSecret
      site_url = $configuration.SiteUrl
      uri_allow_list = ($redirects -join ",")
    } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Patch -Uri $uri -Headers $headers -Body $body | Out-Null
    Write-Host "Google Provider enabled: yes"
  }
  Write-Host "Client ID suffix: $($clientId.Substring($clientId.Length - 6))"
  Write-Host "Secret configured: yes"
} finally {
  $clientSecret = $null
  $clientSecretSecure = $null
  $accessToken = $null
  $accessTokenSecure = $null
}
