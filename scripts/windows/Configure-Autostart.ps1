# Run while Docker Desktop is closed. Enables startup for the current Windows user.
$ErrorActionPreference = 'Stop'
$sourceRoot = $PSScriptRoot
if ((Split-Path -Leaf (Split-Path -Parent $PSScriptRoot)) -eq 'scripts' -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot '../../panel/package.json'))) {
    $sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
}

$taskDockerExe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
$taskDockerSettingsPath = Join-Path $env:APPDATA 'Docker\settings-store.json'
if (-not (Test-Path -LiteralPath $taskDockerExe)) { throw 'Docker Desktop is not installed at the expected path.' }
if (-not (Test-Path -LiteralPath $taskDockerSettingsPath)) { throw 'Docker Desktop settings were not found.' }
$taskAutostartBackupPath = Join-Path $sourceRoot 'backups\docker-settings-before-autostart.json'
New-Item -ItemType Directory -Path (Split-Path -Parent $taskAutostartBackupPath) -Force | Out-Null
if (-not (Test-Path -LiteralPath $taskAutostartBackupPath)) {
    Copy-Item -LiteralPath $taskDockerSettingsPath -Destination $taskAutostartBackupPath
}
$taskDockerSettings = Get-Content -LiteralPath $taskDockerSettingsPath -Raw | ConvertFrom-Json
$taskDockerSettings | Add-Member -NotePropertyName AutoStart -NotePropertyValue $true -Force
$taskDockerSettings | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $taskDockerSettingsPath -Encoding utf8

$taskStartupKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
New-Item -Path $taskStartupKey -Force | Out-Null
New-ItemProperty -LiteralPath $taskStartupKey -Name 'Docker Desktop' -Value ('"' + $taskDockerExe + '"') -PropertyType String -Force | Out-Null
# Remove any per-user disabled-startup marker for this exact startup entry.
$taskStartupApprovalKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
if (Test-Path -LiteralPath $taskStartupApprovalKey) {
    $taskStartupApproval = Get-ItemProperty -LiteralPath $taskStartupApprovalKey
    if ($taskStartupApproval.PSObject.Properties.Name -contains 'Docker Desktop') {
        Remove-ItemProperty -LiteralPath $taskStartupApprovalKey -Name 'Docker Desktop'
    }
}
$taskVerifiedSettings = Get-Content -LiteralPath $taskDockerSettingsPath -Raw | ConvertFrom-Json
[pscustomobject]@{
    AutoStart = $taskVerifiedSettings.AutoStart
    StartupCommand = (Get-ItemProperty -LiteralPath $taskStartupKey).'Docker Desktop'
} | ConvertTo-Json
