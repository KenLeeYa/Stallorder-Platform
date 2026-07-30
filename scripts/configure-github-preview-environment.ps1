[CmdletBinding()]
param(
  [string]$Repository = "KenLeeYa/Stallorder-Platform",
  [string]$Environment = "Preview",
  [string]$VercelProject = "stallorder-platform",
  [string]$VercelScope = "ada76145-8663s-projects",
  [string]$AutomationBypassNote = "Supabase-cron-preview",
  [long]$RerunRunId = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-Command {
  param([Parameter(Mandatory)][string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command is unavailable: $Name"
  }
}

function Read-SecretValue {
  if ($env:VERCEL_TOKEN) {
    return $env:VERCEL_TOKEN
  }

  $secureValue = Read-Host "Vercel Preview token" -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

Assert-Command "gh"
Assert-Command "npx.cmd"

gh auth status 1>$null 2>$null
if ($LASTEXITCODE -ne 0) {
  throw "GitHub CLI is not authenticated."
}

gh api "repos/$Repository/environments/$Environment" 1>$null 2>$null
if ($LASTEXITCODE -ne 0) {
  gh api --method PUT "repos/$Repository/environments/$Environment" 1>$null
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to create the GitHub environment."
  }
}

$previousPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$projectJson = & npx.cmd --yes vercel@58.3.0 api "/v9/projects/$VercelProject" `
  --scope $VercelScope `
  --raw `
  --no-color 2>$null |
  Out-String
$vercelExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousPreference
if ($vercelExitCode -ne 0) {
  throw "Unable to inspect the authenticated Vercel project."
}

$project = $projectJson | ConvertFrom-Json
$projectId = [string]$project.id
$organizationId = [string]$project.accountId
if (-not $projectId -or -not $organizationId) {
  throw "Vercel project metadata is incomplete."
}

gh variable set VERCEL_ORG_ID `
  --env $Environment `
  --repo $Repository `
  --body $organizationId 1>$null
if ($LASTEXITCODE -ne 0) {
  throw "GitHub rejected VERCEL_ORG_ID."
}

gh variable set VERCEL_PROJECT_ID `
  --env $Environment `
  --repo $Repository `
  --body $projectId 1>$null
if ($LASTEXITCODE -ne 0) {
  throw "GitHub rejected VERCEL_PROJECT_ID."
}

$bypassEntry = $null
$protectionBypassProperty = $project.PSObject.Properties["protectionBypass"]
if ($null -ne $protectionBypassProperty -and $null -ne $protectionBypassProperty.Value) {
  $bypassEntry = @(
    $protectionBypassProperty.Value.PSObject.Properties |
    Where-Object { $_.Value.note -eq $AutomationBypassNote }
  ) | Select-Object -First 1
}
if (-not $bypassEntry) {
  throw "The expected Vercel automation bypass was not found."
}

[string]$bypassEntry.Name |
  gh secret set VERCEL_AUTOMATION_BYPASS_SECRET `
    --env $Environment `
    --repo $Repository 1>$null
if ($LASTEXITCODE -ne 0) {
  throw "GitHub rejected VERCEL_AUTOMATION_BYPASS_SECRET."
}

$vercelToken = Read-SecretValue
if ([string]::IsNullOrWhiteSpace($vercelToken)) {
  throw "Vercel Preview token is empty."
}

try {
  $headers = @{ Authorization = "Bearer $vercelToken" }
  $encodedProjectId = [Uri]::EscapeDataString($projectId)
  $encodedOrganizationId = [Uri]::EscapeDataString($organizationId)
  $verifiedProject = Invoke-RestMethod `
    -Uri "https://api.vercel.com/v9/projects/$encodedProjectId`?teamId=$encodedOrganizationId" `
    -Headers $headers `
    -Method Get
  if ([string]$verifiedProject.id -ne $projectId) {
    throw "The token cannot access the expected Vercel project."
  }

  $vercelToken |
    gh secret set VERCEL_TOKEN `
      --env $Environment `
      --repo $Repository 1>$null
  if ($LASTEXITCODE -ne 0) {
    throw "GitHub rejected VERCEL_TOKEN."
  }
} finally {
  $headers = $null
  $vercelToken = $null
}

if ($RerunRunId -gt 0) {
  gh run rerun $RerunRunId --repo $Repository
  if ($LASTEXITCODE -ne 0) {
    throw "GitHub Preview environment was configured, but the workflow rerun failed."
  }
}

[pscustomobject]@{
  repository = $Repository
  environment = $Environment
  variables = @("VERCEL_ORG_ID", "VERCEL_PROJECT_ID")
  secrets = @(
    "VERCEL_TOKEN",
    "VERCEL_AUTOMATION_BYPASS_SECRET"
  )
  rerunRequested = $RerunRunId -gt 0
} | ConvertTo-Json -Depth 3
