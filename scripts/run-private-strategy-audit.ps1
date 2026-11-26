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
# Locate the data independently of the code. Never pull, stash, reset, or
# switch the user's research checkout, even when it is clean.
if ($DataDirectory) {
  $DataDirectory = (Resolve-Path -LiteralPath $DataDirectory -ErrorAction Stop).Path
  if (!(Test-Path -LiteralPath (Join-Path $DataDirectory "trades.json") -PathType Leaf)) {
    throw "The specified DataDirectory does not contain trades.json."
  }
} else {
  $candidates = @()
  if ($env:INSEASON_DIR) { $candidates += $env:INSEASON_DIR }
  if ($ResearchRoot) { $candidates += (Join-Path $ResearchRoot "data\inseason") }
  $candidates += (Join-Path $desktop "vaultvalues\data\inseason")
  $candidates += (Join-Path $desktop "Claude\vaultvalues\data\inseason")
  $files = @($candidates | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ "trades.json") -PathType Leaf) } |
    Select-Object -Unique | ForEach-Object { Get-Item -LiteralPath (Join-Path $_ "trades.json") })
  if (!$files.Count) {
    $parent = Join-Path $desktop "Claude"
    if (Test-Path -LiteralPath $parent -PathType Container) {
      $files = @(Get-ChildItem -LiteralPath $parent -Filter "trades.json" -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.Directory.Name -eq "inseason" })
    }
  }
  if (!$files.Count) { Write-Host "No existing in-season research data found. No checkout or data files were modified."; exit 2 }
  $chosen = $files | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $DataDirectory = $chosen.Directory.FullName
}
Write-Host "Using existing research data at $DataDirectory (read-only)."
# Fetch reviewed main-branch code into a unique disposable checkout. Git only
# downloads repository code; the private research cache stays where it is.
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("vault-strategy-" + [guid]::NewGuid().ToString("N"))
$report = Join-Path $desktop "vault-strategy-validation.json"
$code = 1
try {
  & $git clone --depth 1 --branch main --single-branch $expected $tempRoot
  if ($LASTEXITCODE -ne 0) { throw "Could not download the private research code using existing Git credentials." }
  $runner = Join-Path $tempRoot "scripts\run-strategy-validation.ps1"
  if (!(Test-Path -LiteralPath $runner -PathType Leaf)) { throw "The audit launcher is missing from the fresh checkout." }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runner -DataDirectory $DataDirectory -ReportPath $report
  $code = $LASTEXITCODE
  if ($code -ne 0) { throw "Local research audit failed (exit $code)." }
  Write-Host "Finished. Your original VaultValues checkout and data were left untouched."
} finally {
  if (Test-Path -LiteralPath $tempRoot -PathType Container) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
exit $code
