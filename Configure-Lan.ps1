# Run as administrator to allow Factorio connections from the local network.
$ErrorActionPreference = 'Stop'
$taskLanRuleName = 'FactorioDocker-LocalSubnet-UDP34197'
$taskLanResultPath = Join-Path $PSScriptRoot 'lan-firewall-result.json'
try {
    $taskExistingRule = Get-NetFirewallRule -Name $taskLanRuleName -ErrorAction SilentlyContinue
    if ($taskExistingRule) {
        Set-NetFirewallRule -Name $taskLanRuleName -Enabled True -Direction Inbound -Action Allow -Profile Private -Protocol UDP -LocalPort 34196,34197 -RemoteAddress LocalSubnet | Out-Null
    } else {
        New-NetFirewallRule -Name $taskLanRuleName -DisplayName 'Factorio Docker - local network game and discovery' -Description 'Allow local subnet game connections and LAN discovery on private networks.' -Enabled True -Direction Inbound -Action Allow -Profile Private -Protocol UDP -LocalPort 34196,34197 -RemoteAddress LocalSubnet | Out-Null
    }
    $taskVerifiedRule = Get-NetFirewallRule -Name $taskLanRuleName
    $taskPortFilter = $taskVerifiedRule | Get-NetFirewallPortFilter
    $taskAddressFilter = $taskVerifiedRule | Get-NetFirewallAddressFilter
    [ordered]@{
        success = $true
        name = $taskVerifiedRule.Name
        enabled = [string]$taskVerifiedRule.Enabled
        direction = [string]$taskVerifiedRule.Direction
        action = [string]$taskVerifiedRule.Action
        profile = [string]$taskVerifiedRule.Profile
        protocol = [string]$taskPortFilter.Protocol
        localPort = $taskPortFilter.LocalPort
        remoteAddress = $taskAddressFilter.RemoteAddress
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $taskLanResultPath -Encoding utf8
    if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'panel\server.js')) {
        $taskPanelRuleName = 'FactorioPanel-LocalSubnet-TCP8080'
        if (Get-NetFirewallRule -Name $taskPanelRuleName -ErrorAction SilentlyContinue) {
            Set-NetFirewallRule -Name $taskPanelRuleName -Enabled True -Direction Inbound -Action Allow -Profile Private -Protocol TCP -LocalPort 8080 -RemoteAddress LocalSubnet | Out-Null
        } else {
            New-NetFirewallRule -Name $taskPanelRuleName -DisplayName 'Factorio panel - local network TCP 8080' -Description 'Allow the authenticated Factorio management panel from the local subnet on private networks.' -Enabled True -Direction Inbound -Action Allow -Profile Private -Protocol TCP -LocalPort 8080 -RemoteAddress LocalSubnet | Out-Null
        }
        $taskPanelRule = Get-NetFirewallRule -Name $taskPanelRuleName
        [ordered]@{enabled=[string]$taskPanelRule.Enabled; profile=[string]$taskPanelRule.Profile; remoteAddress=($taskPanelRule | Get-NetFirewallAddressFilter).RemoteAddress; localPort=($taskPanelRule | Get-NetFirewallPortFilter).LocalPort} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'panel-firewall-result.json') -Encoding utf8
    }
} catch {
    @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json | Set-Content -LiteralPath $taskLanResultPath -Encoding utf8
    exit 1
}
