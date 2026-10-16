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
if (-not (Test-Path -LiteralPath "$PSScriptRoot\.panel-data\secrets\controller-token" -PathType Leaf)) {
    throw 'Complete setup first: docker compose run --rm --build setup --new-world (or --save /workspace/import/world.zip).'
}
$dockerOs = & $dockerPath info --format '{{.OSType}}'
if ($LASTEXITCODE -ne 0 -or $dockerOs -ne 'linux') { throw 'Start Docker Desktop using Linux containers.' }
& $dockerPath compose config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose configuration is invalid.' }
& $dockerPath compose up -d --build
if ($LASTEXITCODE -ne 0) { throw 'The server failed to start.' }
& $dockerPath compose ps
Write-Host 'Management panel: http://localhost:8080 (or the address and port configured in .env).'
Write-Host 'Factorio: Multiplayer > Connect to address > localhost:34197 (or the configured LAN address and port).'
