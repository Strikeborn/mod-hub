# Agent scratch task: runs tools/agent-task.mjs (edited per task). Output -> logs/agent-task-latest.log
# Read child-process output (npm/vite/node) as UTF-8 so symbols like the check mark don't turn into mojibake.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$env:NO_COLOR = '1'
$env:FORCE_COLOR = '0'
$modHubDir = Split-Path $PSScriptRoot -Parent
$log = Join-Path $modHubDir 'logs\agent-task-latest.log'
Set-Location $modHubDir
"=== agent-task $(Get-Date -Format s) ===" | Out-File -FilePath $log -Encoding utf8
npx tsx tools/agent-task.mjs 2>&1 | ForEach-Object { "$_" | Out-File -FilePath $log -Append -Encoding utf8 }
"=== DONE exit=$LASTEXITCODE ===" | Out-File -FilePath $log -Append -Encoding utf8
