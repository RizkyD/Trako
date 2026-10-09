<#
.SYNOPSIS
Stops Trako and removes the scheduled task "Trako" that install-service.ps1
registers. Nothing in data\ or logs\ is touched.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts\uninstall-service.ps1 -WhatIf
Prints what it would do, changing nothing.
#>
[CmdletBinding(SupportsShouldProcess)]
param()
$ErrorActionPreference = 'Stop'

$server = Join-Path (Split-Path $PSScriptRoot -Parent) 'server.ts'

if (-not (Get-ScheduledTask -TaskName Trako -ErrorAction SilentlyContinue)) {
  Write-Output 'There is no scheduled task named Trako.'
} elseif ($PSCmdlet.ShouldProcess('Trako', 'Stop and remove the scheduled task')) {
  Stop-ScheduledTask -TaskName Trako
  Unregister-ScheduledTask -TaskName Trako -Confirm:$false
  Write-Output 'Removed the scheduled task Trako.'
}

# Stopping the task can leave node running. The task's node is the one started
# with this folder's server.ts as a quoted full path (npm run dev uses a short one).
# (WhatIf off for this read, or Windows PowerShell reports loading CimCmdlets.)
$pattern = '*' + [WildcardPattern]::Escape("`"$server`"") + '*'
$running = & { $WhatIfPreference = $false; Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" } |
  Where-Object { $_.CommandLine -like $pattern }
foreach ($process in $running) {
  if ($PSCmdlet.ShouldProcess("node.exe, process $($process.ProcessId)", 'Stop the Trako server')) {
    Stop-Process -Id $process.ProcessId -Force
    Write-Output "Stopped the Trako server (process $($process.ProcessId))."
  }
}
