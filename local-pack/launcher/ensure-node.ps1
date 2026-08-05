# Ensure portable Node exists under ../runtime for the Local Live pack.
# Uses official nodejs.org URLs + SHA256 from runtime-manifest.json.
$ErrorActionPreference = 'Stop'
$LauncherDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PackRoot = Split-Path -Parent $LauncherDir
$ManifestPath = Join-Path $LauncherDir 'runtime-manifest.json'
$RuntimeRoot = Join-Path $PackRoot 'runtime'
$NodeDir = Join-Path $RuntimeRoot 'node'
$NodeExe = Join-Path $NodeDir 'node.exe'
$Marker = Join-Path $RuntimeRoot 'node-version.txt'

function Write-Log([string]$msg) {
  $line = "$(Get-Date -Format o) [ensure-node] $msg"
  Write-Host $line
  $logPath = Join-Path $PackRoot 'launcher.log'
  Add-Content -Path $logPath -Value $line -ErrorAction SilentlyContinue
}

if (Test-Path $NodeExe) {
  Write-Log "Portable Node already present: $NodeExe"
  exit 0
}

if (-not (Test-Path $ManifestPath)) {
  Write-Host "Missing runtime-manifest.json" -ForegroundColor Red
  exit 1
}

$manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$platformKey = 'win-x64'
$plat = $manifest.platforms.$platformKey
if (-not $plat) {
  Write-Host "No platform entry for $platformKey" -ForegroundColor Red
  exit 1
}

$ver = $manifest.nodeVersion
$url = $plat.url
$expected = $plat.sha256.ToLowerInvariant()
$tmp = Join-Path $RuntimeRoot 'download-tmp'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$zipPath = Join-Path $tmp 'node.zip'

Write-Host ""
Write-Host "  First run: downloading Node.js v$ver (official nodejs.org)…"
Write-Host "  $url"
Write-Host ""

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing

  $hash = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne $expected) {
    throw "SHA256 mismatch. Expected $expected got $hash"
  }
  Write-Log "Checksum OK"

  if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
  New-Item -ItemType Directory -Force -Path $NodeDir | Out-Null

  # Expand to temp then move node.exe (+ required dlls) from the nested folder
  $extract = Join-Path $tmp 'extract'
  if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
  New-Item -ItemType Directory -Force -Path $extract | Out-Null
  tar -xf $zipPath -C $extract
  if ($LASTEXITCODE -ne 0) { throw "tar extract failed ($LASTEXITCODE)" }

  $nested = Get-ChildItem -Path $extract -Directory | Select-Object -First 1
  if (-not $nested) { throw "Unexpected zip layout" }
  Copy-Item -Path (Join-Path $nested.FullName '*') -Destination $NodeDir -Recurse -Force

  if (-not (Test-Path $NodeExe)) {
    throw "node.exe missing after extract"
  }

  Set-Content -Path $Marker -Value $ver -Encoding ascii
  Write-Log "Installed portable Node v$ver → $NodeExe"
  Write-Host "  Node ready."
  Write-Host ""
  exit 0
}
catch {
  Write-Host ""
  Write-Host "  Failed to install portable Node:" -ForegroundColor Red
  Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
  Write-Host ""
  Write-Host "  Manual fix: install Node.js LTS from https://nodejs.org/"
  Write-Host "  then re-run Start-Windows.bat (system Node can also launch the pack)."
  Write-Host ""
  Write-Log "FAILED: $($_.Exception.Message)"
  exit 1
}
finally {
  if (Test-Path $tmp) {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}
