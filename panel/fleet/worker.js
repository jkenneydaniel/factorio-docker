import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {assert,writeJSON,readJSON} from '../common.js';import {validId} from './catalog.js';import {cloneSnapshot,publishSnapshot} from './snapshots.js';
export async function runWorker(config,{instance='/instance',library='/library'}={}){
 assert(validId(config.fleet)&&validId(config.id)&&['factorio','rust'].includes(config.game),'Invalid worker ownership.');
 const marker=path.join(instance,'.fleet-owner.json'),owner=await readJSON(marker,null);
 if(config.action==='provision'){
  assert(!owner&&(await fs.readdir(instance)).length===0,'A new server requires an empty, unowned volume.');
  await writeJSON(marker,{fleet:config.fleet,id:config.id,game:config.game});
  for(const dir of ['data','state','backups','updates','control'])await fs.mkdir(path.join(instance,dir));
  const data=path.join(instance,'data');for(const dir of config.game==='factorio'?['saves','config','mods']:['server/lobby-goblin-rust/cfg'])await fs.mkdir(path.join(data,dir),{recursive:true});
  if(config.snapshotId)await cloneSnapshot({library,id:config.snapshotId,hash:config.snapshotHash,data,game:config.game,image:config.image});
  await fs.writeFile(path.join(instance,'control/controller-token'),config.controllerToken,{mode:0o600,flag:'wx'});
  if(config.game==='factorio'){
   await writeJSON(path.join(data,'config/server-settings.json'),{name:config.name,description:'Managed by Lobby Goblin',visibility:{public:false,lan:true},require_user_verification:false,max_players:config.maxPlayers,autosave_interval:5,autosave_slots:3,auto_pause:true});
   await fs.writeFile(path.join(data,'config/rconpw'),config.rconPassword,{mode:0o600,flag:'wx'});
   if(!config.snapshotId)await writeJSON(path.join(data,'config/map-gen-settings.json'),{seed:config.seed});
  }else{
   await fs.writeFile(path.join(instance,'control/rcon-password'),config.rconPassword,{mode:0o600,flag:'wx'});
   await fs.writeFile(path.join(data,'server/lobby-goblin-rust/cfg/server.cfg'),`server.hostname "${config.name}"\nserver.description "Managed by Lobby Goblin"\nserver.maxplayers ${config.maxPlayers}\nserver.saveinterval 600\n`,{mode:0o600});
   for(const dir of ['data/server','state','backups'])await writeJSON(path.join(instance,dir,'.lobby-goblin-rust.json'),{game:'rust',instance:config.id});
  }
  return {initialized:true};
 }
 assert(owner?.fleet===config.fleet&&owner.id===config.id&&owner.game===config.game,'Worker storage belongs to another server.',409);
 assert(config.action==='snapshot','Unsupported worker operation.');
 const root=path.join(instance,'backups',config.game==='rust'?'archives':'panel-backups');
 assert(typeof config.backup==='string'&&/^[A-Za-z0-9_.-]+$/.test(config.backup),'Invalid backup filename.');
 return publishSnapshot({library,backup:path.join(root,config.backup),record:{id:config.snapshotId,sourceId:config.id,sourceName:config.name,title:config.title,game:config.game,image:config.image,seed:config.seed,worldSize:config.worldSize}});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const config=await readJSON('/setup/request.json',null);const result=await runWorker(config);await writeJSON('/setup/result.json',result);}
 catch(error){console.error(error.status?error.message:'The isolated storage operation failed. Check storage space and permissions.');process.exitCode=1;}
}
