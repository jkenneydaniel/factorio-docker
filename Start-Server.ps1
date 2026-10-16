# Setup must be completed first; see README.md. Starting applies local changes.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
$dockerPath = if ($dockerCommand) { $dockerCommand.Source } else {
    @("$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin\docker.exe", "$env:ProgramFiles\Docker\Docker\resources\bin\docker.exe") |
        Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $dockerPath) { throw 'Install and start Docker Desktop first.' }
$env:PATH = (Split-Path -Parent $dockerPath) + [IO.Path]::PathSeparator + $env:PATH
& "$PSScriptRoot\Setup.ps1" -Check
if ($LASTEXITCODE -ne 0) { throw 'Setup prerequisite checks failed.' }
if (-not (Test-Path -LiteralPath "$PSScriptRoot\.panel-data\secrets\controller-token" -PathType Leaf)) {
    throw 'Complete guided setup first: .\Setup.ps1'
}
$dockerOs = & $dockerPath info --format '{{.OSType}}'
if ($LASTEXITCODE -ne 0 -or $dockerOs -ne 'linux') { throw 'Start Docker Desktop using Linux containers.' }
& $dockerPath compose config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose configuration is invalid.' }
& $dockerPath compose up -d --build
if ($LASTEXITCODE -ne 0) { throw 'The server failed to start.' }
& $dockerPath compose ps
function Get-ConnectionValue([string]$Key, [string]$Default) {
    $line = @(Get-Content -LiteralPath .env | Where-Object { $_ -match "^$Key=" }) | Select-Object -Last 1
    if ($line) { return $line.Substring($Key.Length + 1) }
    return $Default
}
$serverAddress = Get-ConnectionValue SERVER_ADDRESS 'localhost'
$panelPort = Get-ConnectionValue PANEL_PORT '8080'
$gamePort = Get-ConnectionValue GAME_PORT '34197'
Write-Host "Management panel: http://${serverAddress}:$panelPort"
Write-Host "Factorio: Multiplayer > Connect to address > ${serverAddress}:$gamePort"
