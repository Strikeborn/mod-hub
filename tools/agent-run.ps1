# Agent runner: build Mod Hub, restart it, run deploy probe. Output -> mod-hub\logs\agent-run-latest.log
# Read child-process output (npm/vite/node) as UTF-8 so symbols like the check mark don't turn into mojibake.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$env:NO_COLOR = '1'
$env:FORCE_COLOR = '0'
$ErrorActionPreference = 'Continue'
$modHubDir   = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $modHubDir 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'agent-run-latest.log'

function Log($msg) { "$msg" | Out-File -FilePath $log -Append -Encoding utf8; Write-Host $msg }

"=== agent-run $(Get-Date -Format s) ===" | Out-File -FilePath $log -Encoding utf8
Set-Location $modHubDir

if (-not (Test-Path (Join-Path $modHubDir 'node_modules\steamworks.js'))) {
	Log '--- npm install steamworks.js ---'
	npm install steamworks.js@latest --save --no-audit --no-fund 2>&1 | ForEach-Object { Log "$_" }
	Log "INSTALL_EXIT=$LASTEXITCODE"
}

Log '--- npm run build ---'
npm run build 2>&1 | ForEach-Object { Log "$_" }
Log "BUILD_EXIT=$LASTEXITCODE"

Log '--- stopping running Mod Hub ---'
$me = $PID
$parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$me").ParentProcessId
$escaped = [regex]::Escape($modHubDir)
$procs = Get-CimInstance Win32_Process | Where-Object {
	$_.ProcessId -ne $me -and $_.ProcessId -ne $parent -and
	$_.CommandLine -and $_.CommandLine -match $escaped -and
	$_.CommandLine -notmatch 'agent-' -and
	($_.Name -match '^(electron|node|powershell|pwsh|cmd)\.exe$')
}
foreach ($p in $procs) {
	Log "kill $($p.ProcessId) $($p.Name)"
	Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
# Also kill Electron binaries living under mod-hub\node_modules
Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -match $escaped } | ForEach-Object {
	Log "kill electron $($_.Id)"; Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

Log '--- starting Mod Hub (new window) ---'
$start = Join-Path $PSScriptRoot 'start-mod-hub.ps1'
Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$start`"" -WorkingDirectory $modHubDir
Log "started via $start"

Log '--- npx tsx tools/probe-archive-index.mjs ---'
npx tsx tools/probe-archive-index.mjs 2>&1 | ForEach-Object { Log "$_" }
Log "ARCHIVE_PROBE_EXIT=$LASTEXITCODE"

Log '--- npx tsx tools/probe-deploy-apply.mjs ---'
npx tsx tools/probe-deploy-apply.mjs 2>&1 | ForEach-Object { Log "$_" }
Log "PROBE_EXIT=$LASTEXITCODE"
Log '=== DONE ==='
