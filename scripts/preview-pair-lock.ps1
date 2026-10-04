# Hold a Windows OS file lock until the owning Node process closes stdin.
# The file is never unlinked, so every contender locks the same path.
param([Parameter(Mandatory = $true)][string]$LockPath)
$ErrorActionPreference = 'Stop'
$stream = $null
try {
  $stream = [System.IO.FileStream]::new(
    $LockPath,
    [System.IO.FileMode]::OpenOrCreate,
    [System.IO.FileAccess]::ReadWrite,
    [System.IO.FileShare]::None
  )
  [Console]::Out.WriteLine('LOCKED')
  [Console]::Out.Flush()
  [Console]::In.ReadToEnd() | Out-Null
  exit 0
} catch [System.IO.IOException] {
  exit 75
} catch {
  exit 1
} finally {
  if ($null -ne $stream) { $stream.Dispose() }
}
