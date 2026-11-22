# Blocks: Windows twin of automation-chrome.sh. Starts the automation Chrome
# (profile ~\ChromeAutomation, debug port on 127.0.0.1); exits 0 if it already runs.
#   powershell -File automation-chrome.ps1 [-Port 9222] [-ProfileDir C:\path]
param([int]$Port = 9222, [string]$ProfileDir = "$HOME\ChromeAutomation")
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { Write-Error "Chrome not found"; exit 1 }
function Test-Port { try { (Invoke-RestMethod -TimeoutSec 2 "http://127.0.0.1:$Port/json/version").webSocketDebuggerUrl } catch { $null } }
function Test-Ours { $f = Join-Path $ProfileDir 'DevToolsActivePort'; (Test-Path $f) -and ((Get-Content $f -TotalCount 1) -eq "$Port") }
if (Test-Port) {
  if (Test-Ours) { Write-Output "automation Chrome already running on 127.0.0.1:$Port"; exit 0 }
  Write-Error "Port $Port answers but it is not the automation profile ($ProfileDir). Quit that Chrome or use another -Port."; exit 1
}
New-Item -ItemType Directory -Force $ProfileDir | Out-Null
Start-Process $chrome -ArgumentList "--remote-debugging-port=$Port", "--remote-debugging-address=127.0.0.1", "--user-data-dir=`"$ProfileDir`"", "--no-first-run", "--no-default-browser-check"
for ($i = 0; $i -lt 20; $i++) { if ((Test-Port) -and (Test-Ours)) { Write-Output "automation Chrome started on 127.0.0.1:$Port"; exit 0 }; Start-Sleep 1 }
Write-Error "Chrome did not open debug port $Port within 20s"; exit 1
