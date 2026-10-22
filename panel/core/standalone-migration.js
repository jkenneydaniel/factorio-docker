import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {assert,readJSON,writeJSON,sleep} from '../common.js';
import {daemonPath,setEnvironment} from '../update-source.js';
import {ownedImages} from './game-images.js';
import {migrateImage,replacementSpec} from './image-migration.js';
import {docker as dockerAPI} from './docker.js';
export async function standaloneInstallation(docker,game,names,journal){
 const items={};for(const [key,name] of Object.entries(names)){try{items[key]=await docker('GET','/containers/'+encodeURIComponent(name)+'/json');}catch(error){if(error.status!==404||!journal)throw error;const saved=key==='game'?journal.original:key==='controller'?journal.controllerOriginal:null;assert(saved,'Missing migration resource.',409);if(key==='game'){const retired=await docker('GET','/containers/'+journal.originalId+'/json');assert(!retired.State.Running,'Original game unexpectedly restarted.',409);}items[key]=saved;}}
 const mount=items.game.Mounts?.find(m=>m.Destination===(game==='rust'?'/steamcmd/rust':'/factorio'));
 assert(mount?.Type==='bind'&&items.game.Mounts.length===1,'Standalone migration requires only its installation data bind mount.',409);
 const root=daemonPath(mount.Source).replace(/\/data$/,'');assert(root!==daemonPath(mount.Source),'Standalone data must use the installation data directory.',409);
 const project=items.game.Config.Labels?.['com.docker.compose.project'];assert(project,'Standalone migration requires its Compose ownership labels.',409);
 for(const [key,service] of Object.entries(game==='rust'?{game:'rust',controller:'controller',panel:'panel'}:{game:'factorio',controller:'panel-controller',panel:'panel'})){
  const value=items[key].Config.Labels||{};
  assert(value['com.docker.compose.project']===project&&value['com.docker.compose.service']===service&&daemonPath(value['com.docker.compose.project.working_dir'])===root,'Container ownership does not match this installation.',409);
  assert(String(value['com.docker.compose.project.config_files']).split(',').map(daemonPath).join(',')===root+'/compose.yaml','Compose overrides require a reviewed migration.',409);
 }
 const matches=(item,target,source)=>item.Mounts?.some(m=>m.Type==='bind'&&m.Destination===target&&daemonPath(m.Source)===root+source);
 const expected=game==='rust'?{controller:[['/rust-server','/data/server'],['/rust-state','/control/controller'],['/rust-backups','/backups'],['/run/secrets/controller_token','/control/secrets/controller-token']],panel:[['/auth','/control/auth'],['/run/secrets/controller_token','/control/secrets/controller-token']]}:{controller:[['/factorio','/data'],['/state','/.panel-data/controller'],['/updates','/.panel-data/updates'],['/backups','/backups'],['/run/secrets/controller_token','/.panel-data/secrets/controller-token']],panel:[['/auth','/.panel-data/auth'],['/run/secrets/controller_token','/.panel-data/secrets/controller-token']]};
 for(const [key,mounts] of Object.entries(expected))for(const [target,source] of mounts)assert(matches(items[key],target,source),'Controller or panel storage does not match this installation.',409);
 if(game==='rust')assert(items.game.Config.Labels['io.lobby-goblin.game']==='rust'&&/^[a-f0-9]{32}$/.test(items.game.Config.Labels['io.lobby-goblin.instance']),'Rust installation ownership is missing.',409);
 return {items,root,project};
}
export async function launchStandaloneMigration({docker,game,names,journal}){
 const install=await standaloneInstallation(docker,game,names,journal),name='lobby-goblin-migration-'+(journal?.originalId||install.items.game.Id).slice(0,16);
 try{const existing=await docker('GET','/containers/'+name+'/json');assert(existing.Config.Labels?.['io.lobby-goblin.migration-owner']===(journal?.originalId||install.items.game.Id),'Migration worker ownership mismatch.',409);if(!existing.State.Running&&existing.State.ExitCode!==0)await docker('POST','/containers/'+name+'/start');return name;}catch(error){if(error.status!==404)throw error;}
 const networks=Object.keys(install.items.controller.NetworkSettings?.Networks||{});assert(networks.length===1,'Controller requires one management network.',409);
 await docker('POST','/containers/create?'+new URLSearchParams({name}),{Image:install.items.controller.Image,User:'0:0',Entrypoint:['node','/app/core/standalone-migration.js'],Env:['MIGRATION_ROOT='+install.root,'MIGRATION_GAME='+game,'MIGRATION_NAMES='+JSON.stringify(names)],Labels:{'io.lobby-goblin.migration-owner':journal?.originalId||install.items.game.Id},HostConfig:{AutoRemove:true,NetworkMode:networks[0],ReadonlyRootfs:true,CapDrop:['ALL'],CapAdd:['DAC_OVERRIDE','CHOWN','FOWNER'],SecurityOpt:['no-new-privileges:true'],Memory:512*1024**2,Tmpfs:{'/tmp':'rw,nosuid,size=64m'},Mounts:[{Type:'bind',Source:install.root,Target:install.root},{Type:'bind',Source:'/var/run/docker.sock',Target:'/var/run/docker.sock'}],LogConfig:{Type:'json-file',Config:{'max-size':'2m','max-file':'2'}}}});
 await docker('POST','/containers/'+name+'/start');
 return name;
}
export async function runStandaloneMigration({docker=dockerAPI,root=process.env.MIGRATION_ROOT,game=process.env.MIGRATION_GAME,names=JSON.parse(process.env.MIGRATION_NAMES||'null'),fetch=globalThis.fetch}={}){
 assert(['factorio','rust'].includes(game)&&names,'Invalid migration request.',409);
 const privateRoot=path.join(root,game==='rust'?'control/controller':'.panel-data/updates'),journalFile=path.join(privateRoot,'image-migration.json'),journal=await readJSON(journalFile,null);
 async function save(state){
  // The Factorio controller reads this as 845; publish only after ownership is set.
  const temporary=journalFile+'.pending';await writeJSON(temporary,state);
  if(game==='factorio'&&process.getuid?.()===0)await fs.chown(temporary,845,845);
  await fs.rename(temporary,journalFile);
 }
 const install=await standaloneInstallation(docker,game,names,journal);assert(root===install.root,'Migration root changed.',409);
 const token=(await fs.readFile(path.join(root,game==='rust'?'control/secrets/controller-token':'.panel-data/secrets/controller-token'),'utf8')).trim();
 async function request(route,body){const response=await fetch('http://'+names.controller+':8081'+route,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json','x-lobby-goblin-migration':token},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const result=await response.json();assert(response.ok,result.error||'Controller request failed.',response.status);return result;}
 async function job(action){const queued=await request('/jobs',{action,params:{confirm:true},actor:'automatic image migration'});for(let n=0;n<1800;n++){const value=await request('/jobs'),item=value.jobs.find(j=>j.id===queued.id);if(item&&!['queued','running'].includes(item.state)&&!value.active){assert(item.state==='succeeded','Migration '+action+' failed.',409);return item.result;}await sleep(1000);}throw Error('Migration operation did not complete.');}
 return migrateImage({docker,name:names.game,game,target:ownedImages[game],journal,save,retainOriginal:false,
  owned:async info=>{const labels=info.Config.Labels||{},original=install.items.game.Config.Labels;assert(labels['com.docker.compose.project']===install.project&&labels['com.docker.compose.service']===original['com.docker.compose.service']&&JSON.stringify(info.Mounts.map(m=>({Type:m.Type,Source:m.Source,Destination:m.Destination,RW:m.RW})))===JSON.stringify(install.items.game.Mounts.map(m=>({Type:m.Type,Source:m.Source,Destination:m.Destination,RW:m.RW}))),'Migration container storage or ownership changed.',409);},
  backupStop:async()=>{const backup=await job('backup');assert(/^Backup created: [A-Za-z0-9_.-]+\.(zip|tar\.gz)$/.test(backup),'Migration backup was not verified.',409);await job('stop');return backup.slice('Backup created: '.length);},
  configured:async state=>{
   const envFile=path.join(root,'.env'),before=await fs.readFile(envFile,'utf8');if(!await readJSON(path.join(privateRoot,'migration-environment.json'),null))await writeJSON(path.join(privateRoot,'migration-environment.json'),{environment:before});
   async function replaceText(file,text){const stat=await fs.stat(file),pending=file+'.lg034-pending';await fs.writeFile(pending,text,{mode:stat.mode&0o777});if(process.getuid?.()===0)await fs.chown(pending,stat.uid,stat.gid);await fs.rename(pending,file);}
   await replaceText(envFile,setEnvironment(before,game==='rust'?'RUST_IMAGE':'FACTORIO_IMAGE',state.target));
   if(game==='rust'){
    const recordFile=path.join(root,'installation.json'),record=await readJSON(recordFile,null);
    if(record){assert(record.game==='rust'&&record.instance===state.original.Config.Labels['io.lobby-goblin.instance'],'Installation metadata belongs to another server.',409);await replaceText(recordFile,JSON.stringify({...record,image:state.target},null,2)+'\n');}
    let old;try{old=await docker('GET','/containers/'+names.controller+'/json');}catch(error){if(error.status!==404||!state.controllerOriginal)throw error;}
    if(!state.controllerOriginal){state.controllerOriginal=old;await save(state);}
    if(!old||!old.Config.Env.includes('RUST_IMAGE='+state.target)){
     if(old?.State.Running)await docker('POST','/containers/'+names.controller+'/stop?t=30');if(old)await docker('DELETE','/containers/'+names.controller);
     await docker('POST','/containers/create?'+new URLSearchParams({name:names.controller}),replacementSpec(state.controllerOriginal,state.controllerOriginal.Image,{env:{RUST_IMAGE:state.target}}));
    }
    const current=await docker('GET','/containers/'+names.controller+'/json');if(!current.State.Running)await docker('POST','/containers/'+names.controller+'/start');
   }
  },
  ready:async()=>{for(let n=0;n<900;n++){try{if((await request('/status')).ready)return;}catch{}await sleep(2000);}throw Error('Migrated game did not reach readiness. Its backup and original container were retained.');}
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runStandaloneMigration().catch(()=>{console.error('Automatic image migration needs attention. Data, backup and original container configuration were preserved.');process.exitCode=1;});
