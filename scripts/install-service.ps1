<#
.SYNOPSIS
Runs Trako in the background: registers the scheduled task "Trako", which starts
the server whenever you sign in to Windows, and starts it now.

.DESCRIPTION
The task runs scripts\service.cmd in a hidden console (conhost --headless), which
starts this folder's server.ts with the current node executable (npm start
cannot be used, as the npm scripts here run through Git Bash), NODE_ENV=production
and PORT, appending the output to logs\trako.log. Running the script again
replaces the task with the new settings.

.PARAMETER Port
The port the server listens on. Default 44100.

.PARAMETER BehindProxy
For a reverse proxy on this PC (see README): listen on 127.0.0.1 only and set
TRUST_PROXY=1.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1 -WhatIf
Prints what it would do, changing nothing.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [int]$Port = 44100,
  [switch]$BehindProxy
)
$ErrorActionPreference = 'Stop'

$app = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node).Source
$conhost = Join-Path $env:windir 'System32\conhost.exe'
# Plain arguments only: conhost re-quotes what it passes on, so a cmd /c line
# with quotes inside it would not survive.
$arguments = "--headless `"$(Join-Path $PSScriptRoot 'service.cmd')`" `"$node`" $Port"
if ($BehindProxy) { $arguments += ' proxy' }

Write-Output "Task Trako runs at sign-in of $env:USERDOMAIN\$env:USERNAME, in $app"
Write-Output "Command: $conhost $arguments"

# An existing task and its server go first, so the new settings take effect.
& (Join-Path $PSScriptRoot 'uninstall-service.ps1') -WhatIf:$WhatIfPreference

$action = New-ScheduledTaskAction -Execute $conhost -Argument $arguments -WorkingDirectory $app
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
# Without these, Task Scheduler stops the server after 3 days, or on battery.
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

if ($PSCmdlet.ShouldProcess('Trako', 'Register the scheduled task and start it')) {
  Register-ScheduledTask -TaskName Trako -Action $action -Trigger $trigger -Settings $settings `
    -Description 'Trako server (scripts\install-service.ps1)' | Out-Null
  Start-ScheduledTask -TaskName Trako
  Write-Output "Registered and started the task Trako: http://localhost:$Port, log in $app\logs\trako.log"
}
