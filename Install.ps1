param([Parameter(ValueFromRemainingArguments = $true)][string[]]$InstallArguments)
$ErrorActionPreference = 'Stop'
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVersion = & node --version
    if ($LASTEXITCODE -eq 0 -and $nodeVersion -match '^v(\d+)\.' -and [int]$Matches[1] -ge 22) {
        & node (Join-Path $PSScriptRoot 'panel/install.js') @InstallArguments
        exit $LASTEXITCODE
    }
}
if ($InstallArguments -contains '--help') {
    Write-Host 'Lobby Goblin: run Install.ps1 for guided setup. Use --prepare, --start or --check. See docs/INSTALLATION.md.'
    exit 0
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Install and start Docker Desktop with Linux containers, then rerun Install.ps1.' }
$endpointStatus = 0
$endpoint = if ($env:DOCKER_HOST) { $env:DOCKER_HOST } else { & docker context inspect --format '{{.Endpoints.docker.Host}}'; $endpointStatus = $LASTEXITCODE }
if ($endpointStatus -ne 0 -or $endpoint -notmatch '^(npipe|unix)://') { throw 'Use a local Docker Desktop context on this computer.' }
if ($InstallArguments -contains '--check') {
    if ($InstallArguments.Count -ne 1) { throw 'Install Node 22+ to check installation files with --directory.' }
    $details = (& docker info --format '{{json .}}') | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $details.OSType -ne 'linux' -or $details.Architecture -notin @('amd64','x86_64') -or [int]($details.ServerVersion.Split('.')[0]) -lt 26 -or ($details.SecurityOptions -join ',') -match 'rootless') { throw 'The host manager needs Docker Engine 26+ with Linux x86-64 containers, without rootless mode.' }
    $version = & docker compose version --short
    $versionMatch = [regex]::Match($version, '^v?(\d+)\.(\d+)')
    if ($LASTEXITCODE -ne 0 -or -not $versionMatch.Success -or [int]$versionMatch.Groups[1].Value -lt 2 -or ([int]$versionMatch.Groups[1].Value -eq 2 -and [int]$versionMatch.Groups[2].Value -lt 24)) { throw 'Docker Compose 2.24+ is required.' }
    Write-Host "Docker $($details.ServerVersion), Compose $version. No files changed or containers started."
    exit 0
}
for ($i = 0; $i -lt $InstallArguments.Count; $i++) {
    if ($InstallArguments[$i] -eq '--directory' -and $i + 1 -lt $InstallArguments.Count) {
        if ([IO.Path]::IsPathRooted($InstallArguments[$i+1]) -or $InstallArguments[$i+1] -match '(^|[\\/])\.\.([\\/]|$)') { throw 'Use a relative --directory path inside the current directory, or install Node 22+ to use other Windows paths.' }
        $InstallArguments[$i+1] = $InstallArguments[$i+1].Replace('\','/')
    }
}
if ($PSScriptRoot.Contains(',') -or (Get-Location).Path.Contains(',')) { throw 'Use a directory without commas, or install Node 22+ to run the installer directly.' }
$version = (Get-Content (Join-Path $PSScriptRoot 'panel/package.json') -Raw | ConvertFrom-Json).version
$dockerArgs = @('run','--rm','--user','0:0','--mount',"type=bind,source=$PSScriptRoot,target=/installer,readonly",'--mount',"type=bind,source=$((Get-Location).Path),target=/workspace",'--mount','type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock','--workdir','/workspace','--entrypoint','node',"ghcr.io/jkenneydaniel/lobby-goblin:$version",'/installer/panel/install.js') + $InstallArguments
if (-not [Console]::IsInputRedirected) { $dockerArgs = @('run','-it') + $dockerArgs[1..($dockerArgs.Count-1)] }
& docker @dockerArgs
exit $LASTEXITCODE
