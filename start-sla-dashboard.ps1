# ──────────────────────────────────────────────────────────────────────────────
# SLA Dashboard — Auto-start script
# Launches backend (node server.js) and ngrok tunnel in hidden windows.
# Triggered at Windows logon by Task Scheduler task "SLA Dashboard Auto Start".
# Logs to: <project>\logs\backend.log, ngrok.log (and .err.log)
# ──────────────────────────────────────────────────────────────────────────────
$ErrorActionPreference = 'Continue'

$projectRoot = "C:\Users\Ngoc\OneDrive - MORTGAGE EZY PTY LTD\Project_VibeCoding\SLA Dashboard"
$backendDir  = Join-Path $projectRoot "backend"
$logDir      = Join-Path $projectRoot "logs"
$ngrokExe    = "C:\Users\Ngoc\ngrok.exe"

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

# Stamp the launch log
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
"[$stamp] Auto-start triggered" | Out-File -Append (Join-Path $logDir 'autostart.log')

# ── Kill any stale instances first (prevents EADDRINUSE on port 5000) ─────────
Get-Process -Name node  -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name ngrok -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# ── Start backend ─────────────────────────────────────────────────────────────
Start-Process -FilePath "node" `
  -ArgumentList "server.js" `
  -WorkingDirectory $backendDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logDir "backend.log") `
  -RedirectStandardError  (Join-Path $logDir "backend.err.log")

# Give backend ~6 s to bind port 5000 before ngrok opens the tunnel
Start-Sleep -Seconds 6

# ── Start ngrok (free static URL is auto-assigned to this account) ────────────
Start-Process -FilePath $ngrokExe `
  -ArgumentList @("http", "5000", "--log=stdout") `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logDir "ngrok.log") `
  -RedirectStandardError  (Join-Path $logDir "ngrok.err.log")

"[$stamp] backend + ngrok launched" | Out-File -Append (Join-Path $logDir 'autostart.log')
