# CAW Live Board launcher — 3922 only. Desktop shortcut target.
$ErrorActionPreference = "Stop"
$repo = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $repo "package.json"))) {
  $repo = "C:\Users\Ourten\Desktop\caw-live-board-clean"
}
Set-Location $repo

$port = 3922
$url = "http://127.0.0.1:$port/"

function Test-BoardUp {
  try {
    $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -First 1
    return $null -ne $c
  } catch {
    return $false
  }
}

if (-not (Test-BoardUp)) {
  $npmCmd = $null
  foreach ($name in @("npm.cmd", "npm")) {
    $c = Get-Command $name -ErrorAction SilentlyContinue
    if ($c) { $npmCmd = $c.Source; break }
  }
  if (-not $npmCmd) {
    Write-Host "npm not found in PATH"
    exit 1
  }
  Start-Process -FilePath $npmCmd -ArgumentList @("run", "board") -WorkingDirectory $repo -WindowStyle Minimized
  $deadline = (Get-Date).AddSeconds(120)
  while (-not (Test-BoardUp)) {
    if ((Get-Date) -gt $deadline) {
      Write-Host "Board did not bind :$port in time"
      exit 1
    }
    Start-Sleep -Milliseconds 500
  }
}

Start-Process $url
