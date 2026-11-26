# Run the private research audit without a hosted runner. No private file upload.
[CmdletBinding()]
param([string]$ResearchRoot = "", [string]$DataDirectory = "")
$ErrorActionPreference = "Stop"
$desktop = [Environment]::GetFolderPath("Desktop")
$expected = "https://github.com/jacobpalmer60-coder/vaultvalues.git"
$git = (Get-Command git -ErrorAction Stop).Source
$valid = {
  param($dir)
  if (!$dir -or !(Test-Path -LiteralPath (Join-Path $dir ".git"))) { return $false }
  $url = & $git -C $dir config --get remote.origin.url 2>$null
  return ($LASTEXITCODE -eq 0 -and ($url -match '^(https://github\.com/|git@github\.com:)jacobpalmer60-coder/vaultvalues(\.git)?/?$'))
}
if ($ResearchRoot) {
  if (!(& $valid $ResearchRoot)) { throw "ResearchRoot is not a verified VaultValues checkout." }
} else {
  $paths = @((Join-Path $desktop "vaultvalues"), (Join-Path $desktop "Claude\vaultvalues"))
  $ResearchRoot = $paths | Where-Object { & $valid $_ } | Select-Object -First 1
  if (!$ResearchRoot) {
    $parent = Join-Path $desktop "Claude"
    if (Test-Path -LiteralPath $parent -PathType Container) {
      $ResearchRoot = Get-ChildItem -LiteralPath $parent -Directory -Recurse -Filter "vaultvalues" -ErrorAction SilentlyContinue |
        Where-Object { & $valid $_.FullName } | Select-Object -First 1 -ExpandProperty FullName
    }
  }
}
if (!$ResearchRoot) {
  $ResearchRoot = Join-Path $desktop "vaultvalues"
  if (Test-Path -LiteralPath $ResearchRoot) { throw "A folder already exists at the research checkout location; it was not modified. Supply -ResearchRoot for the actual VaultValues repository." }
  & $git clone $expected $ResearchRoot
  if ($LASTEXITCODE -ne 0) { throw "Could not clone the private repository with existing Git credentials." }
}
$branch = & $git -C $ResearchRoot branch --show-current
if ($LASTEXITCODE -ne 0 -or $branch -ne "main") { throw "VaultValues checkout must be on main; no branches were changed." }
$changes = & $git -C $ResearchRoot status --porcelain --untracked-files=no
if ($LASTEXITCODE -ne 0 -or $changes) { throw "VaultValues has tracked local modifications; not overwriting them." }
& $git -C $ResearchRoot pull --ff-only
if ($LASTEXITCODE -ne 0) { throw "Could not update VaultValues safely; no forced reset attempted." }
$runner = Join-Path $ResearchRoot "scripts\run-strategy-validation.ps1"
if (!(Test-Path -LiteralPath $runner -PathType Leaf)) { throw "The audit launcher was not found after update." }
$report = Join-Path $desktop "vault-strategy-validation.json"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runner -DataDirectory $DataDirectory -ReportPath $report
$code = $LASTEXITCODE
if ($code -eq 2) { Write-Host "Research cache was not found; existing files remain untouched." }
elseif ($code -ne 0) { throw "Local research audit failed (exit $code)." }
exit $code
