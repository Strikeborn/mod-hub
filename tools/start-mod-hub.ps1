# Start Mod Hub. Each run writes a UTF-8 log to logs/ (never overwritten).
# Default: run the built app (fast; rebuilds first only if source files changed since the last build).
# -Dev: Vite dev server + hot reload + DevTools (for working on Mod Hub itself).
# Keep this file ASCII-only: Windows PowerShell 5 reads BOM-less scripts as ANSI.
param([switch]$Dev)
$ErrorActionPreference = 'Stop'

# Show npm/vite/electron output as UTF-8 so symbols render instead of mojibake.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$host.UI.RawUI.WindowTitle = 'Mod Hub - console'

$modHubDir = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $modHubDir 'package.json'))) {
	throw "Mod Hub not found: $modHubDir"
}

$logDir = Join-Path $modHubDir 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logPath = Join-Path $logDir "mod-hub-run-$stamp.log"
$data = Join-Path $env:APPDATA 'mod-hub'
$ansi = [regex]'\x1b\[[0-9;]*[A-Za-z]'

function Write-Line([string]$text) {
	$clean = $ansi.Replace($text, '')
	# Known harmless DevTools noise in Electron builds.
	if ($clean -match "Autofill\.(enable|setAddresses)") { return }
	$time = Get-Date -Format 'HH:mm:ss'
	"$time  $clean" | Out-File -FilePath $logPath -Append -Encoding utf8
	$color = 'Gray'
	if ($clean -match '(?i)\b(error|failed|exception)\b') { $color = 'Red' }
	elseif ($clean -match '(?i)\bwarn') { $color = 'Yellow' }
	elseif ($clean -match '^\[Mod Hub') { $color = 'Cyan' }
	elseif ($clean -match '(?i)^\s*(built in|ready in)|\bready\b') { $color = 'Green' }
	elseif ($clean -match '^\s*$') { return }
	Write-Host "$time  " -NoNewline -ForegroundColor DarkGray
	Write-Host $clean -ForegroundColor $color
}

Write-Host ''
Write-Host '  MOD HUB - console' -ForegroundColor Cyan
Write-Host '  -------------------------------------------------------------' -ForegroundColor DarkGray
Write-Host "  Started   $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "  Log       $logPath"
Write-Host "  Catalog   $data\catalog.json"
Write-Host "  Settings  $data\settings.json"
Write-Host "  Vault     $data\vault  (hard links to Vortex downloads)"
Write-Host '  Use the window titled "Mod Hub" - not localhost:5173 in a browser.' -ForegroundColor DarkGray
Write-Host '  Close this window to quit Mod Hub.' -ForegroundColor DarkGray
Write-Host '  -------------------------------------------------------------' -ForegroundColor DarkGray
Write-Host ''
"=== Mod Hub run $stamp ===" | Out-File -FilePath $logPath -Encoding utf8

Set-Location $modHubDir
$ErrorActionPreference = 'Continue'

if (-not (Test-Path (Join-Path $modHubDir 'node_modules'))) {
	Write-Line 'First run: installing dependencies...'
	npm install 2>&1 | ForEach-Object { Write-Line "$_" }
}

if ($Dev) {
	Write-Line 'Dev mode: Vite dev server + hot reload.'
	npm run dev 2>&1 | ForEach-Object { Write-Line "$_" }
	Write-Line 'Mod Hub exited.'
	return
}

# Rebuild only when a source file is newer than the last build output.
$built = @('dist-electron\main.js', 'dist-electron\preload.cjs', 'dist\index.html') | ForEach-Object { Join-Path $modHubDir $_ }
$oldestBuild = $null
foreach ($f in $built) {
	if (-not (Test-Path $f)) { $oldestBuild = [datetime]::MinValue; break }
	$t = (Get-Item $f).LastWriteTime
	if ($null -eq $oldestBuild -or $t -lt $oldestBuild) { $oldestBuild = $t }
}
$sources = @(
	@('src', 'electron', 'shared', 'public') | ForEach-Object { Get-ChildItem -Path (Join-Path $modHubDir $_) -Recurse -File -ErrorAction SilentlyContinue }
	@('index.html', 'vite.config.ts', 'package.json') | ForEach-Object { Get-Item (Join-Path $modHubDir $_) -ErrorAction SilentlyContinue }
)
$newest = ($sources | Measure-Object -Property LastWriteTime -Maximum).Maximum
if ($oldestBuild -lt $newest) {
	Write-Line 'Source changed since last build - building (a few seconds)...'
	npm run build 2>&1 | ForEach-Object { Write-Line "$_" }
	if ($LASTEXITCODE -ne 0) {
		Write-Line 'Build failed - starting dev mode instead.'
		npm run dev 2>&1 | ForEach-Object { Write-Line "$_" }
		Write-Line 'Mod Hub exited.'
		return
	}
}

$electron = Join-Path $modHubDir 'node_modules\electron\dist\electron.exe'
& $electron . --no-sandbox 2>&1 | ForEach-Object { Write-Line "$_" }
Write-Line 'Mod Hub exited.'
