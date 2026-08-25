param(
  [int]$MinimumFreeGb = 15
)

$ErrorActionPreference = "Continue"
$failures = 0
$warnings = 0

function Write-HealthResult {
  param(
    [ValidateSet("PASS", "WARN", "FAIL")]
    [string]$Status,
    [string]$Label,
    [string]$Detail = ""
  )

  if ($Status -eq "FAIL") { $script:failures += 1 }
  if ($Status -eq "WARN") { $script:warnings += 1 }
  $suffix = if ($Detail) { " - $Detail" } else { "" }
  Write-Output "$Status $Label$suffix"
}

Write-Output "StallOrder Docker Desktop health check (read-only)"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-HealthResult FAIL "Docker CLI" "not found in PATH"
  exit 1
}

$desktopStatus = (& docker desktop status 2>&1 | Out-String).Trim()
Write-HealthResult $(if ($LASTEXITCODE -eq 0 -and $desktopStatus -match "running") { "PASS" } else { "FAIL" }) "Docker Desktop" $(if ($desktopStatus) { $desktopStatus -replace "\s+", " " } else { "status unavailable" })

$serverVersion = (& docker info --format '{{.ServerVersion}}' 2>&1 | Out-String).Trim()
Write-HealthResult $(if ($LASTEXITCODE -eq 0 -and $serverVersion) { "PASS" } else { "FAIL" }) "Docker Engine" $(if ($serverVersion) { $serverVersion } else { "daemon unavailable" })

$containers = (& docker ps --format '{{.Names}}' 2>&1 | Out-String).Trim()
Write-HealthResult $(if ($LASTEXITCODE -eq 0) { "PASS" } else { "FAIL" }) "Container query" $(if ($containers) { "running containers detected" } else { "no running containers" })

if (Get-Command wsl.exe -ErrorAction SilentlyContinue) {
  & wsl.exe --status *> $null
  Write-HealthResult $(if ($LASTEXITCODE -eq 0) { "PASS" } else { "WARN" }) "WSL status" $(if ($LASTEXITCODE -eq 0) { "available" } else { "status command failed" })
} else {
  Write-HealthResult WARN "WSL status" "wsl.exe not found"
}

$workspaceDrive = (Get-Item -LiteralPath (Get-Location).Path).PSDrive
$freeGb = [math]::Round($workspaceDrive.Free / 1GB, 1)
Write-HealthResult $(if ($freeGb -ge $MinimumFreeGb) { "PASS" } else { "FAIL" }) "Workspace disk space" "$freeGb GB free; minimum $MinimumFreeGb GB"

if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 54321 -ErrorAction SilentlyContinue)
  $unexpectedOwners = @($listeners | ForEach-Object {
    Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
  } | Where-Object {
    $_.ProcessName -notmatch "docker|wsl|com\.docker|vpnkit"
  } | Select-Object -ExpandProperty ProcessName -Unique)

  if ($unexpectedOwners.Count -gt 0) {
    Write-HealthResult WARN "Supabase API port 54321" "also owned by: $($unexpectedOwners -join ', '); localhost may resolve differently from 127.0.0.1"
  } elseif ($listeners.Count -gt 0) {
    Write-HealthResult PASS "Supabase API port 54321" "listener detected"
  } else {
    Write-HealthResult WARN "Supabase API port 54321" "no listener; start the local Supabase stack before integration tests"
  }
}

Write-Output "Summary: $failures failure(s), $warnings warning(s)."
if ($failures -gt 0) {
  Write-Output "See docs/LOCAL_DOCKER_DESKTOP_RECOVERY.md before making recovery changes."
  exit 1
}
exit 0
