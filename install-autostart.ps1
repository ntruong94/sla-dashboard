# Run this once to register the auto-start task in Windows Task Scheduler.
# To remove: Unregister-ScheduledTask -TaskName "SLA Dashboard Auto Start" -Confirm:$false

$scriptPath = "C:\Users\Ngoc\OneDrive - MORTGAGE EZY PTY LTD\Project_VibeCoding\SLA Dashboard\start-sla-dashboard.ps1"
$taskName   = "SLA Dashboard Auto Start"
$fullUser   = "$env:USERDOMAIN\$env:USERNAME"

Write-Host "Registering task for user: $fullUser"

# Remove existing task if present (idempotent re-install)
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed previous task registration"
}

$argString = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $scriptPath + '"'
$action    = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argString
$trigger   = New-ScheduledTaskTrigger -AtLogOn -User $fullUser
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 0) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)

# Use -User parameter instead of -Principal (simpler, works without domain SID lookup)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -User $fullUser -RunLevel Limited -Description "Starts SLA Dashboard backend + ngrok tunnel at user logon"

Write-Host ""
Write-Host "=== Task registered ==="
Get-ScheduledTask -TaskName $taskName | Format-List TaskName, State, Author, Description
