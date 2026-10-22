import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assert,readJSON,writeJSON,sleep} from '../common.js';
import {docker as dockerAPI} from '../core/docker.js';
import {replacementSpec} from '../core/image-migration.js';

export function assertAgentContainer(info,state,item){
 const labels=info.Config?.Labels||{},project='lobby-goblin-fleet-'+state.fleet;
 assert(labels['io.lobby-goblin.fleet']===state.fleet&&labels['io.lobby-goblin.role']===item.role,'Agent container ownership changed.',409);
 assert(info.Mounts?.every(m=>m.Type==='volume'&&[project+'-state',project+'-library',project+'-web'].includes(m.Name)||m.Type==='bind'&&m.Source==='/var/run/docker.sock'&&m.Destination==='/var/run/docker.sock'),'Agent mounts changed. No containers were replaced.',409);
 if(item.role==='host-controller')assert(info.Config.Env?.includes('FLEET_AGENT_ONLY=true')&&info.Mounts.some(m=>m.Name===state.stateVolume&&m.Destination==='/fleet'),'Only agent-only host controllers can update here.',409);
}
export async function runAgentUpdate(state,{docker=dockerAPI,save,wait=sleep}={}){
 assert(/^[a-f0-9]{32}$/.test(state.fleet)&&/^[a-f0-9]{32}$/.test(state.id)&&state.stateVolume==='lobby-goblin-fleet-'+state.fleet+'-state','Invalid agent update ownership.');
 const expected=[['lobby-goblin-host-'+state.fleet,'host-controller'],['lobby-goblin-agent-'+state.fleet,'host-agent-web']];assert(state.containers?.length===2&&state.containers.every((item,n)=>item.name===expected[n][0]&&item.role===expected[n][1]),'Invalid agent replacement scope.');
 const inspect=async name=>{try{return await docker('GET','/containers/'+encodeURIComponent(name)+'/json');}catch(error){if(error.status===404)return null;throw error;}};
 const owned=async(name,item)=>{const info=await inspect(name);if(info)assertAgentContainer(info,state,item);return info;};
 const healthy=async(name,item)=>{for(let n=0;n<90;n++){const info=await owned(name,item);assert(info?.State.Running,'The replacement management container stopped.',409);if(info.State.Health?.Status==='healthy')return;assert(info.State.Health?.Status!=='unhealthy','The replacement management container is unhealthy.',409);await wait(1000);}assert(false,'The replacement management container did not become healthy.',409);};
 async function rollback(){
  for(const entry of [...state.entries].reverse()){
   const current=await owned(entry.name,entry),original=await owned(entry.retain,entry);
   if(current&&current.Id!==entry.original.Id){assert(entry.newId&&current.Id===entry.newId,'A management container changed during recovery.',409);if(current.State.Running)await docker('POST','/containers/'+current.Id+'/stop?t=30');await docker('DELETE','/containers/'+current.Id);}
   if(original){assert(original.Id===entry.original.Id,'Recovery container changed.',409);await docker('POST','/containers/'+original.Id+'/rename?'+new URLSearchParams({name:entry.name}));await docker('POST','/containers/'+original.Id+'/update',{RestartPolicy:entry.original.HostConfig.RestartPolicy});await docker('POST','/containers/'+original.Id+'/start');}
   else{assert(current?.Id===entry.original.Id,'The previous agent container is unavailable. Inspect recovery manually.',409);await docker('POST','/containers/'+current.Id+'/update',{RestartPolicy:entry.original.HostConfig.RestartPolicy});if(!current.State.Running)await docker('POST','/containers/'+current.Id+'/start');}
  }
  state.state='failed';state.rolledBack=true;state.message='Agent update failed or was interrupted. Previous management containers were restored; games were left unchanged.';await save(state);
 }
 try{
  if(state.recover){await rollback();return state;}
  assert(/^ghcr\.io\/jkenneydaniel\/lobby-goblin@sha256:[a-f0-9]{64}$/.test(state.target)&&/^sha256:[a-f0-9]{64}$/.test(state.imageId),'Invalid reviewed runtime image.');
  const prepared=[];
  for(const item of state.containers){
   const original=await owned(item.name,item);assert(original?.Id===item.id&&original.State.Running,'Agent changed before replacement.',409);
   const retain=item.name+'-before-agent-'+state.id;assert(!await inspect(retain),'An agent recovery container already exists.',409);
   prepared.push({...item,retain,original});
  }
  state.entries=prepared;await save(state);
  for(const entry of state.entries){
   const original=await owned(entry.name,entry);assert(original.Id===entry.original.Id,'Agent changed during replacement.',409);
   state.message='Replacing '+(entry.role==='host-controller'?'host controller':'host agent')+'…';await save(state);
   await docker('POST','/containers/'+original.Id+'/update',{RestartPolicy:{Name:'no'}});
   await docker('POST','/containers/'+original.Id+'/stop?t=30');await docker('POST','/containers/'+original.Id+'/rename?'+new URLSearchParams({name:entry.retain}));
   const spec=replacementSpec(entry.original,state.imageId,{env:entry.role==='host-controller'?{FLEET_IMAGE:state.target,FLEET_SKIP_MIGRATIONS:'true'}:{}});
   const created=await docker('POST','/containers/create?'+new URLSearchParams({name:entry.name}),spec);entry.newId=created.Id;await save(state);
   await docker('POST','/containers/'+created.Id+'/start');await healthy(entry.name,entry);
  }
  state.state='complete';state.message='Agent matches the panel version. Game containers and worlds were left unchanged.';await save(state);
  for(const entry of state.entries){const original=await owned(entry.retain,entry);if(original){assert(original.Id===entry.original.Id&&!original.State.Running,'Retained agent container changed.',409);await docker('DELETE','/containers/'+original.Id);}}
 }catch{
  if(state.state==='complete')return state; // Cleanup cannot undo a healthy update.
  try{await rollback();}catch{state.state='attention';state.message='Agent update recovery needs attention. Previous containers and storage were retained. Recover the agent before other host operations.';await save(state);}
 }return state;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const file='/fleet/agent-update.json',state=await readJSON(file,null);assert(state?.fleet===process.env.FLEET_ID,'Agent update does not belong to this helper.');await sleep(2000);
 await runAgentUpdate(state,{save:next=>writeJSON(file,next)});
}
