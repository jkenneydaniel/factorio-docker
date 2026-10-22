[CmdletBinding()]
param([string]$Address='localhost',[ValidateRange(1024,65535)][int]$PanelPort=8082,[ValidateRange(2,128)][int]$MemoryGiB=16,[switch]$BuildOnly)
$ErrorActionPreference='Stop'
$sourceRoot = $PSScriptRoot
if ((Split-Path -Leaf (Split-Path -Parent $PSScriptRoot)) -eq 'scripts' -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot '../../panel/package.json'))) {
    $sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
}
$root=$sourceRoot
$envFile=Join-Path $root '.env.fleet'
$composeFile=Join-Path $root 'deploy/fleet/compose.yaml'
if(!(Test-Path -LiteralPath $composeFile)){$composeFile=Join-Path $root 'fleet.compose.yaml'}
if($Address -notmatch '^[A-Za-z0-9.-]+$'){throw 'Use an IPv4 address or local hostname.'}
$docker=(Get-Command docker -ErrorAction SilentlyContinue).Source
if(!$docker){$docker=Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe'}
if(!(Test-Path -LiteralPath $docker)){throw 'Start Docker with Linux containers first.'}
$env:PATH=(Split-Path -Parent $docker)+[IO.Path]::PathSeparator+$env:PATH
$infoText=& $docker info --format '{{json .}}'
if($LASTEXITCODE -ne 0){throw 'Start Docker with Linux containers first.'}
$info=$infoText | ConvertFrom-Json
if($info.OSType -ne 'linux' -or $info.Architecture -notin @('x86_64','amd64') -or [int]($info.ServerVersion.Split('.')[0]) -lt 26){throw 'The host manager requires Docker Engine 26+ with Linux amd64 containers.'}

if(!(Test-Path -LiteralPath $envFile)){
 $id=[Guid]::NewGuid().ToString('N')
 $content="FLEET_ID=$id`nFLEET_IMAGE=ghcr.io/jkenneydaniel/lobby-goblin:0.3.5-alpha`nFLEET_ADDRESS=$Address`nFLEET_PANEL_PORT=$PanelPort`nFLEET_PANEL_BIND=0.0.0.0`nFLEET_GAME_BIND=0.0.0.0`nFLEET_GAME_PORT_BASE=35000`nFLEET_MEMORY_GIB=$MemoryGiB`n"
 [IO.File]::WriteAllText($envFile,$content,(New-Object Text.UTF8Encoding($false)))
}
$idLine=Select-String -LiteralPath $envFile -Pattern '^FLEET_ID=([a-f0-9]{32})$'
if(!$idLine){throw 'The fleet configuration needs a fresh 32-character lowercase hex FLEET_ID.'}
$id=$idLine.Matches[0].Groups[1].Value
$arguments=@('compose','--project-directory',$root,'--env-file',$envFile,'-f',$composeFile,'-p',"lobby-goblin-fleet-$id")
if($BuildOnly){
 & $docker @arguments build fleet-controller
 if($LASTEXITCODE -ne 0){throw 'Host manager build failed.'}
 return
}
$content=[IO.File]::ReadAllText($envFile)
$content=[regex]::Replace($content,'(?m)^FLEET_IMAGE=local/lobby-goblin-host:[^\r\n]+','FLEET_IMAGE=ghcr.io/jkenneydaniel/lobby-goblin:0.3.5-alpha')
[IO.File]::WriteAllText($envFile,$content,(New-Object Text.UTF8Encoding($false)))
& $docker @arguments pull fleet-controller fleet-web
if($LASTEXITCODE -ne 0){throw 'The published host image could not be downloaded. No existing servers were changed.'}
& $docker @arguments up -d --no-build
if($LASTEXITCODE -ne 0){throw 'Host manager did not start. Existing standalone servers were not changed.'}
Write-Host 'Host manager started. Use this private one-time link to register your administrator:'
& $docker @arguments exec -T fleet-controller cat /web-state/registration-link.txt
