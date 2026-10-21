# Install cursor-agent-workflow into Cursor's extensions folder (no network).
# Usage: powershell -File scripts\install-cursor.ps1

$ErrorActionPreference = "Stop"
$userHome = $env:USERPROFILE
$project = Split-Path -Parent $PSScriptRoot
$vsix = Get-ChildItem $project -Filter "cursor-agent-workflow-*.vsix" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $vsix) {
  Write-Error "No .vsix found. Run: npm run package"
}

$extRoot = Join-Path $userHome ".cursor\extensions"
New-Item -ItemType Directory -Force -Path $extRoot | Out-Null

$dest = Join-Path $extRoot "ourten.cursor-agent-workflow-0.1.0"
if (Test-Path $dest) {
  Remove-Item -Recurse -Force $dest
}

$staging = Join-Path $env:TEMP ("caw-vsix-" + [guid]::NewGuid().ToString("n"))
New-Item -ItemType Directory -Force -Path $staging | Out-Null
try {
  Copy-Item $vsix.FullName (Join-Path $staging "ext.zip")
  Expand-Archive -Path (Join-Path $staging "ext.zip") -DestinationPath $staging -Force
  $inner = Join-Path $staging "extension"
  if (-not (Test-Path $inner)) {
    Write-Error "VSIX missing extension/ folder"
  }
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Copy-Item -Path (Join-Path $inner "*") -Destination $dest -Recurse -Force
  Write-Host "Installed -> $dest"
  Write-Host "Restart Cursor, then open Activity Bar: Agent Workflow"
} finally {
  Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
}
