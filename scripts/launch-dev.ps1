# Launches OpenLite straight from this checkout (electron-vite dev), so every
# launch runs the current source with no build step. The desktop shortcut runs
# this hidden; output goes to %LOCALAPPDATA%\OpenLite-Dev\launcher.log.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $env:LOCALAPPDATA 'OpenLite-Dev'
$log = Join-Path $logDir 'launcher.log'
New-Item -ItemType Directory -Force $logDir | Out-Null

Add-Type -AssemblyName System.Windows.Forms

# Already running from this checkout: don't start a second copy.
$running = Get-Process electron -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "$repo\node_modules\*" }
if ($running) {
    [System.Windows.Forms.MessageBox]::Show('OpenLite is already running.', 'OpenLite') | Out-Null
    exit 0
}

Set-Location $repo
$branch = git rev-parse --abbrev-ref HEAD 2>$null
[System.IO.File]::WriteAllText($log, "[$(Get-Date -Format s)] Launching OpenLite from $repo (branch $branch)`r`n")

# The debugging port lets Claude inspect the running client. cmd does the
# redirection so the log stays plain text.
cmd /c "`"$repo\node_modules\.bin\electron-vite.cmd`" dev --remoteDebuggingPort 9222 >> `"$log`" 2>&1"
$code = $LASTEXITCODE

if ($code -ne 0) {
    $tail = (Get-Content $log -Tail 15) -join "`n"
    [System.Windows.Forms.MessageBox]::Show("OpenLite exited with code $code.`n`n$tail`n`nFull log: $log", 'OpenLite') | Out-Null
}
