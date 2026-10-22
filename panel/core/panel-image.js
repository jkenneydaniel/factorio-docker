import {assert} from '../common.js';
export const panelRepository='ghcr.io/jkenneydaniel/lobby-goblin';
export function panelImage(version){
 assert(/^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/.test(version),'Invalid panel image version.');
 return panelRepository+':'+version;
}
export function validatePanelImage(info,version){
 assert(info?.Os==='linux'&&['amd64','arm64'].includes(info.Architecture)&&/^sha256:[a-f0-9]{64}$/.test(info.Id),'The panel image must support this Linux Docker host.');
 const labels=info.Config?.Labels||{};
 assert(labels['org.opencontainers.image.version']===version&&labels['org.opencontainers.image.source']==='https://github.com/jkenneydaniel/lobby-goblin'&&labels['io.lobby-goblin.runtime']==='1','The published panel image does not match the verified release.');
 const digest=info.RepoDigests?.find(value=>value.startsWith(panelRepository+'@')&&/^sha256:[a-f0-9]{64}$/.test(value.slice(panelRepository.length+1)));
 assert(digest,'The panel image has no published repository digest.');
 return panelImage(version)+'@'+digest.split('@')[1];
}

export async function inspectPanelImage(reference,version,run){
 let info=JSON.parse(await run(['image','inspect',reference]))[0];
 if(!info?.Config){
  const architecture=(await run(['info','--format','{{.Architecture}}'])).trim(),arch={x86_64:'amd64',amd64:'amd64',aarch64:'arm64',arm64:'arm64'}[architecture];
  assert(arch,'The published panel image requires a supported Linux Docker host.');
  info=JSON.parse(await run(['image','inspect','--platform','linux/'+arch,reference]))[0];
 }
 return validatePanelImage(info,version);
}
