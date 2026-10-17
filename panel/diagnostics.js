import fs from 'node:fs/promises';

const check=(id,title,state,detail,steps=[],link=null)=>({id,title,state,detail,steps,link});
export const controllerUnavailable=()=>check('controller','Controller connection','error','The panel is responding, but the controller could not be reached.',[
  'Open Docker and check that the panel-controller service is running.',
  'If it is stopped, use the setup guide on the host. Check that the panel and controller share the same controller token.',
  'Review controller logs on the host for startup or permission errors, then run these checks again.'
]);
export function diagnosticsReport(panelVersion,controller=null){
  const checks=[check('panel','Panel & sign-in','pass','The panel answered an authenticated request.'),...(controller?.checks||[controllerUnavailable()]),check('network','Joining from another device','manual','A browser health check cannot prove that a Factorio client can reach the game.',[
    'Use the connection address in Settings on another device on the same network.',
    'Match the game version and enabled mods. Allow UDP port 34197 through the host firewall.',
    'If joining fails, check the host address, Docker port mapping and router or Wi-Fi isolation.'
  ],'#settings')];
  return {schema:1,checkedAt:new Date().toISOString(),versions:{panel:panelVersion,controller:controller?.version||null},checks};
}
// All probes are metadata reads. Never start containers, exec commands, write a
// test file, or expose raw Docker data, filesystem paths, settings, or logs.
export async function controllerDiagnostics({docker,container,locations,recentStatus=null,version,access=fs.access,statfs=fs.statfs}){
  const checks=[];
  const read=route=>docker('GET',route,undefined,{timeout:4000});
  const [engine,game]=await Promise.allSettled([read('/info'),read(`/containers/${encodeURIComponent(container)}/json`)]);
  checks.push(check('controller','Controller connection','pass','The controller answered this diagnostic request.'));
  if(engine.status==='fulfilled'){
    const arch=engine.value?.Architecture,arm=['arm64','aarch64'].includes(arch),known=['arm64','aarch64','x86_64','amd64'].includes(arch);
    const windows=engine.value?.OSType==='windows';
    checks.push(check('docker','Docker engine',windows?'error':'pass',windows?'Docker is using Windows containers. Factorio needs Linux containers.':'The controller can read Docker engine metadata.',windows?['Switch Docker Desktop to Linux containers on the host, then run these checks again.']:[]));
    checks.push(check('platform','Host architecture',arm?'warning':known?'pass':'unknown',arm?'Docker reports an ARM host. Factorio uses the Linux amd64 image through emulation.':known?'Docker reports an x86-64 host.':'Docker did not report a recognized architecture.',arm?['Ensure Linux amd64 emulation is enabled in Docker on the host.','A running container alone does not prove emulation performance. Check game readiness and try joining with a client.']:known?[]:['Check the host architecture and Docker setup on the host.']));
  }else{
    checks.push(check('docker','Docker engine','error','The controller cannot read Docker engine metadata.',['Check that Docker is running.','Check the controller socket mount and permissions on the host. Do not make the Docker socket publicly accessible.']));
    checks.push(check('platform','Host architecture','unknown','Architecture could not be checked until Docker responds.'));
  }
  if(game.status==='fulfilled'){
    const state=game.value?.State||{};
    checks.push(check('game','Game container',state.Running?'pass':'warning',state.Running?'Docker reports the game container as running.':'The game container is stopped or starting.',state.Running?[]:['Open Overview to review the server state.','Check Activity for startup errors before choosing whether to start the server.'],'#overview'));
    checks.push(check('readiness','Game readiness',!state.Running?'unknown':recentStatus?.ready?'pass':recentStatus?'warning':'unknown',!state.Running?'Readiness cannot be checked while the game is stopped.':recentStatus?.ready?'The most recent status check received a game response.':recentStatus?'The recent status check could not reach the game command interface.':'No recent game response is available. These checks do not run commands in the game.',!state.Running||recentStatus?.ready?[]:['Open Overview for a fresh game status, then return and check again.','If the game remains unavailable, review Activity for version, mod, startup or emulation errors.'],'#overview'));
  }else checks.push(check('game','Game container',game.reason?.status===404?'error':'unknown',game.reason?.status===404?'The configured game container was not found.':'Game container metadata could not be read.',['Check that host setup created the game service and that the controller container name matches it.']));
  await Promise.all(locations.map(async({id,title,path})=>{
    let readable=false,writable=false;
    try{await access(path,fs.constants.R_OK);readable=true;await access(path,fs.constants.W_OK);writable=true;}catch{}
    const result=check(id,title,readable&&writable?'pass':'error',readable&&writable?'The controller has read and write access according to filesystem permissions. No files were written.':readable?'The controller can read this location but lacks write permission.':'The controller cannot read this location.',readable&&writable?[]:['Check the mounted directory exists on the host.','Check its ownership and read/write permissions for the controller. Re-run host setup if the mount configuration is missing.']);
    try{const disk=await statfs(path),free=Number(disk.bavail)*Number(disk.bsize);if(Number.isFinite(free)&&free>=0){result.freeBytes=free;if(free<1024**3){if(result.state==='pass')result.state='warning';result.detail+=' Less than 1 GB is free.';result.steps.push('Free space or move older backups to another device before generating worlds or installing updates.');}}}catch{result.detail+=' Free space could not be checked.';if(result.state==='pass')result.state='unknown';}
    return result;
  })).then(results=>checks.push(...results));
  return {version,checks};
}
