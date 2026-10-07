# Agent watcher: runs fixed agent scripts when a trigger file appears. Close this window to stop.
# Read child-process output (npm/vite/node) as UTF-8 so symbols like the check mark don't turn into mojibake.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$env:NO_COLOR = '1'
$env:FORCE_COLOR = '0'
#   .trigger-run  -> agent-run.ps1  (build, restart Mod Hub, probes)
#   .trigger-task -> agent-task.ps1 (runs tools/agent-task.mjs)
$tools = $PSScriptRoot
$host.UI.RawUI.WindowTitle = 'Mod Hub agent watcher'
Write-Host "Watching $tools for agent triggers. Close this window to stop."
while ($true) {
	foreach ($pair in @(@('.trigger-run', 'agent-run.ps1'), @('.trigger-task', 'agent-task.ps1'))) {
		$trigger = Join-Path $tools $pair[0]
		if (Test-Path $trigger) {
			Remove-Item $trigger -Force -ErrorAction SilentlyContinue
			Write-Host "$(Get-Date -Format T) running $($pair[1])"
			& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $tools $pair[1])
			Write-Host "$(Get-Date -Format T) finished $($pair[1])"
		}
	}
	Start-Sleep -Milliseconds 800
}
