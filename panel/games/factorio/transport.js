import {docker,demultiplex} from '../../core/docker.js';
import {HttpError} from '../../common.js';

// Compose platform selection does not propagate to containers created by API.
export function gameContainerRoute(name,platform=process.env.FACTORIO_PLATFORM||'linux/amd64') {
  return '/containers/create?'+new URLSearchParams({name,platform});
}

export async function rcon(command, container=process.env.FACTORIO_CONTAINER||'factorio-server',request=docker) {
  const exec=await request('POST',`/containers/${encodeURIComponent(container)}/exec`,{AttachStdout:true,AttachStderr:true,Cmd:['rcon',command]});
  const output=demultiplex(await request('POST',`/exec/${exec.Id}/start`,{Detach:false,Tty:false},{raw:true,timeout:20000}));
  const state=await request('GET',`/exec/${exec.Id}/json`);
  if(state.ExitCode!==0)throw new HttpError(409,'Factorio is not ready to receive commands.');
  return output.trim();
}
