param(
    [switch]$Check,
    [switch]$NewWorld,
    [string]$Save,
    [switch]$RegistrationLink,
    [string]$Address,
    [switch]$Start,
    [switch]$Help
)
$ErrorActionPreference = 'Stop'
$sourceRoot = $PSScriptRoot
if ((Split-Path -Leaf (Split-Path -Parent $PSScriptRoot)) -eq 'scripts' -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot '../../panel/package.json'))) {
    $sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
}
Set-Location -LiteralPath $sourceRoot
if ($Help) {
    Write-Host @'
Lobby Goblin setup (Windows PowerShell 5.1+)
  .\Setup.ps1                            Guided setup; asks before starting
  .\Setup.ps1 -Check                     Read-only prerequisite/config check
  .\Setup.ps1 -NewWorld [-Address HOST]   Prepare without starting the stack
  .\Setup.ps1 -Save 'import/world.zip'    Import without starting the stack
  .\Setup.ps1 -RegistrationLink          Replace an expired registration link
  Add -Start to explicitly start/apply the stack after successful setup.
'@
    exit 0
}
$modes = @($NewWorld, [bool]$Save, $RegistrationLink) | Where-Object { $_ }
if (@($modes).Count -gt 1) { throw 'Choose one setup mode.' }
if ($Check -and (@($modes).Count -gt 0 -or $Address -or $Start)) { throw '-Check cannot be combined with setup options.' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    $candidate = @("$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin\docker.exe", "$env:ProgramFiles\Docker\Docker\resources\bin\docker.exe") |
        Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $candidate) { throw 'Install and start Docker Desktop using Linux containers. See docs/SETUP.md.' }
    $env:PATH = (Split-Path -Parent $candidate) + [IO.Path]::PathSeparator + $env:PATH
}
function Invoke-SetupDocker {
    & docker @args
    if ($LASTEXITCODE -ne 0) { throw 'Docker command failed. Check Docker Desktop and the message above.' }
}
Invoke-SetupDocker compose version | Out-Null
$endpoint = if ($env:DOCKER_HOST) { $env:DOCKER_HOST } else { Invoke-SetupDocker context inspect --format '{{.Endpoints.docker.Host}}' }
if ($endpoint -notmatch '^(npipe|unix)://') { throw 'Use a local Docker context. Remote daemons cannot use bind mounts from this checkout.' }
$details = (Invoke-SetupDocker info --format '{{.OSType}}|{{.Architecture}}|{{.OperatingSystem}}|{{json .SecurityOptions}}') -split '\|', 4
if ($details[0] -ne 'linux') { throw 'Switch Docker Desktop to Linux containers.' }
if ($details[1] -notin @('x86_64','amd64','aarch64','arm64')) { throw 'Requires an x86-64 or ARM64 Docker host.' }
if ($details[3] -match 'rootless') { throw 'Rootless Docker is not supported by this controller/socket layout.' }
Write-Host "Lobby Goblin - local Docker $($details[1])"
if ($details[1] -in @('aarch64','arm64')) { Write-Host 'Factorio 2.0.77 requires amd64 emulation; the panel runs natively on ARM64. See docs/SETUP.md.' }
if ((Test-Path -LiteralPath .env) -and ((Get-Item -Force -LiteralPath .env).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Refusing a symlink at .env.' }
function Get-SetupValue([string]$Key, [string]$Default) {
    $line = @(Get-Content -LiteralPath .env | Where-Object { $_ -match "^$Key=" }) | Select-Object -Last 1
    if ($line) { return $line.Substring($Key.Length + 1) }
    return $Default
}
if ((Test-Path -LiteralPath .env) -and (Get-SetupValue FACTORIO_PLATFORM 'linux/amd64') -ne 'linux/amd64') { throw 'This release requires FACTORIO_PLATFORM=linux/amd64 for game and preview workers.' }
if ($Check) {
    $config = if (Test-Path -LiteralPath .env) { '.env' } else { '.env.example' }
    Invoke-SetupDocker compose --env-file $config config --quiet
    Write-Host "Configuration valid ($config). No files changed or containers started."
    Write-Host 'Emulation, port availability and LAN reachability are not proven by this check.'
    exit 0
}
$guided = @($modes).Count -eq 0
if ($guided) {
    if ([Console]::IsInputRedirected) { throw 'Non-interactive use needs -NewWorld, -Save, -RegistrationLink or -Check.' }
    Write-Host '1) New world / preserve existing installation'
    Write-Host '2) Import a Factorio save ZIP'
    Write-Host '3) Replace an expired registration link'
    $choice = Read-Host 'Choice [1]'
    switch ($choice) {
        { $_ -in @('', '1') } { $NewWorld = $true }
        '2' { $Save = Read-Host 'Copy the ZIP into import/ first. Path (e.g. import/world.zip)' }
        '3' { $RegistrationLink = $true }
        default { throw 'Choose 1, 2 or 3.' }
    }
}
if ($Save) {
    $Save = $Save.Replace('\','/')
    if ($Save -notmatch '^import/.+\.zip$' -or $Save -match '(^|/)\.{1,2}(/|$)' -or -not (Test-Path -LiteralPath $Save -PathType Leaf)) { throw 'Copy the ZIP into import/ and supply its relative path, without dot segments.' }
}
if ($guided -and -not (Test-Path -LiteralPath .env) -and -not $Address) {
    $Address = Read-Host 'Address friends connect to (reserved LAN IPv4 or hostname), or blank for this computer only [localhost]'
}
if ($Address -and $Address -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]*$') { throw 'Use a hostname or IPv4 without a scheme, port, spaces or path.' }
if (-not (Test-Path -LiteralPath .env)) { Copy-Item -LiteralPath .env.example -Destination .env }
function Set-SetupValue([string]$Key, [string]$Value) {
    $found = $false
    $lines = @(foreach ($line in Get-Content -LiteralPath .env) {
        if ($line -match "^$Key=") { "$Key=$Value"; $found = $true } else { $line }
    })
    if (-not $found) { $lines += "$Key=$Value" }
    # UTF-8 without BOM is accepted by Compose in both PowerShell 5.1 and 7.
    [IO.File]::WriteAllLines((Join-Path $sourceRoot '.env'), $lines, ([System.Text.UTF8Encoding]::new($false)))
}
if ($Address) { Set-SetupValue SERVER_ADDRESS $Address }
# Windows Docker Desktop exposes the Linux VM's socket to the controller.
Set-SetupValue DOCKER_SOCKET_GID 0
if ((Get-SetupValue PANEL_IMAGE '') -match '^local/(lobby-goblin|factory-control):') { Set-SetupValue PANEL_IMAGE 'ghcr.io/jkenneydaniel/lobby-goblin:0.3.5-alpha' }
Invoke-SetupDocker compose pull panel panel-controller setup
Invoke-SetupDocker compose config --quiet
Write-Host 'Preparing world data and private registration. This does not start the stack.'
if ($Save) { Invoke-SetupDocker compose run --rm --no-build setup --save "/workspace/$Save" }
elseif ($RegistrationLink) { Invoke-SetupDocker compose run --rm --no-build setup --registration-link }
else { Invoke-SetupDocker compose run --rm --no-build setup --new-world }
if ($guided -and -not $Start) { $Start = (Read-Host 'Start/apply now? Existing players may disconnect. [y/N]') -match '^(y|yes)$' }
if ($Start) {
    Invoke-SetupDocker compose up -d --no-build
    Invoke-SetupDocker compose ps
} else { Write-Host 'Prepared. When ready, run: docker compose up -d --no-build' }
$serverAddress = Get-SetupValue SERVER_ADDRESS 'localhost'
$panelPort = Get-SetupValue PANEL_PORT '8080'
$gamePort = Get-SetupValue GAME_PORT '34197'
Write-Host "Panel: http://${serverAddress}:$panelPort"
Write-Host "Factorio: ${serverAddress}:$gamePort"
Write-Host 'Use the private registration link printed above after starting the stack.'
Write-Host 'Allow the configured TCP panel and UDP game ports from your trusted LAN. See docs/SETUP.md.'
