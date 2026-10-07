# Creates Desktop\games\Mod Hub.lnk — launches Mod Hub via tools/start-mod-hub.ps1
$ErrorActionPreference = 'Stop'

$modHubDir = Split-Path $PSScriptRoot -Parent
$launcher = Join-Path $PSScriptRoot 'start-mod-hub.ps1'
$gamesDir = Join-Path ([Environment]::GetFolderPath('Desktop')) 'games'
$shortcutPath = Join-Path $gamesDir 'Mod Hub.lnk'

if (-not (Test-Path $launcher)) { throw "Missing launcher: $launcher" }
if (-not (Test-Path $gamesDir)) { New-Item -ItemType Directory -Path $gamesDir -Force | Out-Null }

$args = "-NoProfile -ExecutionPolicy Bypass -File `"$launcher`""

$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcutPath)
$link.TargetPath = 'powershell.exe'
$link.Arguments = $args
$link.WorkingDirectory = $modHubDir
$link.Description = 'Mod Hub — scan and manage Steam Workshop, Nexus, and local mods'
$electronExe = Join-Path $modHubDir 'node_modules\electron\dist\electron.exe'
if (Test-Path $electronExe) { $link.IconLocation = "$electronExe,0" }
$link.Save()

Write-Host "Created: $shortcutPath"
