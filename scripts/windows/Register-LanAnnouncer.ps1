$ErrorActionPreference = 'Stop'
$taskPwshPath = (Get-Command pwsh -ErrorAction Stop).Source
$taskAnnouncerPath = Join-Path $PSScriptRoot 'Start-LanAnnouncer.ps1'
$taskRunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$taskStartupCommand = '"' + $taskPwshPath + '" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $taskAnnouncerPath + '"'
New-ItemProperty -LiteralPath $taskRunKey -Name 'Factorio LAN discovery' -Value $taskStartupCommand -PropertyType String -Force | Out-Null
$taskApprovalKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
if (Test-Path -LiteralPath $taskApprovalKey) {
    $taskApproval = Get-ItemProperty -LiteralPath $taskApprovalKey
    if ($taskApproval.PSObject.Properties.Name -contains 'Factorio LAN discovery') {
        Remove-ItemProperty -LiteralPath $taskApprovalKey -Name 'Factorio LAN discovery'
    }
}
Start-Process -FilePath $taskPwshPath -WindowStyle Hidden -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "' + $taskAnnouncerPath + '"')
Write-Output 'Factorio LAN discovery is registered at Windows sign-in and has been started.'
