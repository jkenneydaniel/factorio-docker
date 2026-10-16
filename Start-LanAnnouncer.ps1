param([int]$DurationSeconds = 0)

$ErrorActionPreference = 'Stop'
$taskAnnouncerMutex = [Threading.Mutex]::new($false, 'Local\FactorioDockerLanAnnouncer')
if (-not $taskAnnouncerMutex.WaitOne(0)) { $taskAnnouncerMutex.Dispose(); exit 0 }
$taskDockerCommand = Get-Command docker -ErrorAction SilentlyContinue
$taskDockerPath = if ($taskDockerCommand) { $taskDockerCommand.Source } else { "$env:ProgramFiles\Docker\Docker\resources\bin\docker.exe" }
$taskStatusPath = Join-Path $PSScriptRoot 'data\lan-announcer-status.json'
$taskPeersPath = Join-Path $PSScriptRoot 'data\lan-discovery-peers.json'
$taskStartTime = [DateTime]::UtcNow
$taskNextRefresh = [DateTime]::MinValue
$taskSockets = @()
$taskServerRunning = $false
# Captured from the running Factorio 2.0.77 server: LANBroadcast message type
# 0x2f, followed by the game port 34197 as a little-endian unsigned short.
[byte[]]$taskAnnouncement = 0x2f, 0x95, 0x85
try {
    while ($DurationSeconds -eq 0 -or ([DateTime]::UtcNow - $taskStartTime).TotalSeconds -lt $DurationSeconds) {
        $taskWriteStatus = $false
        if ([DateTime]::UtcNow -ge $taskNextRefresh) {
            $taskWriteStatus = $true
            foreach ($taskSocket in $taskSockets) { $taskSocket.Client.Dispose() }
            $taskSockets = @()
            try {
                $taskDockerState = & $taskDockerPath inspect --format '{{.State.Running}}' factorio-server 2>$null
                $taskServerRunning = $LASTEXITCODE -eq 0 -and $taskDockerState -eq 'true'
                $taskPeers = if (Test-Path -LiteralPath $taskPeersPath) { @(Get-Content -LiteralPath $taskPeersPath -Raw | ConvertFrom-Json) } else { @() }
                foreach ($taskNic in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
                    if ($taskNic.OperationalStatus -ne 'Up' -or $taskNic.NetworkInterfaceType -notin @('Ethernet', 'Wireless80211')) { continue }
                    if ($taskNic.Description -match 'Virtual|Hyper-V|Docker|WSL|VPN|WireGuard|Tailscale') { continue }
                    $taskIpProperties = $taskNic.GetIPProperties()
                    if (-not ($taskIpProperties.GatewayAddresses | Where-Object { $_.Address.AddressFamily -eq 'InterNetwork' -and $_.Address.ToString() -ne '0.0.0.0' })) { continue }
                    foreach ($taskUnicast in $taskIpProperties.UnicastAddresses) {
                        if ($taskUnicast.Address.AddressFamily -ne 'InterNetwork') { continue }
                        $taskIpBytes = $taskUnicast.Address.GetAddressBytes()
                        $taskMaskBytes = $taskUnicast.IPv4Mask.GetAddressBytes()
                        [byte[]]$taskBroadcastBytes = 0, 0, 0, 0
                        for ($taskIndex = 0; $taskIndex -lt 4; $taskIndex++) {
                            $taskBroadcastBytes[$taskIndex] = $taskIpBytes[$taskIndex] -bor ((-bnot $taskMaskBytes[$taskIndex]) -band 255)
                        }
                        $taskBroadcast = [Net.IPAddress]::new($taskBroadcastBytes)
                        $taskUdp = [Net.Sockets.UdpClient]::new([Net.IPEndPoint]::new($taskUnicast.Address, 0))
                        $taskUdp.EnableBroadcast = $true
                        $taskTargets = @([Net.IPEndPoint]::new($taskBroadcast, 34196), [Net.IPEndPoint]::new([Net.IPAddress]::Broadcast, 34196))
                        foreach ($taskPeer in $taskPeers) {
                            $taskPeerIp = [Net.IPAddress]::Parse([string]$taskPeer)
                            if ($taskPeerIp.AddressFamily -ne 'InterNetwork') { continue }
                            $taskPeerBytes = $taskPeerIp.GetAddressBytes()
                            $taskSameSubnet = $true
                            for ($taskIndex = 0; $taskIndex -lt 4; $taskIndex++) {
                                if (($taskPeerBytes[$taskIndex] -band $taskMaskBytes[$taskIndex]) -ne ($taskIpBytes[$taskIndex] -band $taskMaskBytes[$taskIndex])) { $taskSameSubnet = $false }
                            }
                            if ($taskSameSubnet) { $taskTargets += [Net.IPEndPoint]::new($taskPeerIp, 34196) }
                        }
                        $taskSockets += [pscustomobject]@{
                            Client = $taskUdp
                            Targets = $taskTargets
                            Address = $taskUnicast.Address.ToString()
                            Interface = $taskNic.Name
                        }
                    }
                }
                $taskLastError = $null
            } catch {
                $taskLastError = $_.Exception.Message
                $taskServerRunning = $false
            }
            $taskNextRefresh = [DateTime]::UtcNow.AddSeconds(10)
        }
        if ($taskServerRunning) {
            foreach ($taskSocket in $taskSockets) {
                try {
                    foreach ($taskTarget in $taskSocket.Targets) {
                        $null = $taskSocket.Client.Send($taskAnnouncement, $taskAnnouncement.Length, $taskTarget)
                    }
                } catch { $taskLastError = $_.Exception.Message }
            }
        }
        if ($taskWriteStatus) { [ordered]@{
            updated = [DateTime]::UtcNow.ToString('o')
            processId = $PID
            serverRunning = $taskServerRunning
            interfaces = @($taskSockets | Select-Object Interface, Address, @{Name='Targets';Expression={@($_.Targets | ForEach-Object { $_.ToString() })}})
            payloadHex = '2f9585'
            error = $taskLastError
        } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $taskStatusPath -Encoding utf8 }
        Start-Sleep -Seconds 2
    }
} finally {
    foreach ($taskSocket in $taskSockets) { $taskSocket.Client.Dispose() }
    $taskAnnouncerMutex.ReleaseMutex()
    $taskAnnouncerMutex.Dispose()
}
