import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {docker,rcon,demultiplex} from './docker.js';
import {assert,HttpError,sleep,stamp,readJSON,writeJSON,json,readBody,requestJSON,safeName,existingFile,inside,equalSecret,redact} from './common.js';
import {makeZip,zipEntries,validateWorld} from './zip.js';
import {validateBackup,summarizeBackups} from './backup-health.js';
import {exportMap} from './map-export.js';
import {completedSave,saveVersion,SaveMapQueue} from './save-map.js';
import {LivePlayers} from './live-players.js';
import {validateConfiguration} from './world-settings.js';
import {WorldPreviews,renderWorldPreview,cleanPreviewWorkers} from './world-preview.js';
import {engineMapSettings,mergeSettings} from './engine-settings.js';
const worldDefaults=await readJSON(new URL('./world-defaults.json',import.meta.url));

const data=process.env.FACTORIO_DATA||'/factorio';
const backups=process.env.BACKUPS_DIR||'/backups';
const state=process.env.STATE_DIR||'/state';
const container=process.env.FACTORIO_CONTAINER||'factorio-server';
const token=(await fs.readFile(process.env.CONTROLLER_TOKEN_FILE||'/run/secrets/controller_token','utf8')).trim();
const saves=path.join(data,'saves'), settingsFile=path.join(data,'config/server-settings.json');
const library=path.join(backups,'panel-worlds'), backupDir=path.join(backups,'panel-backups');
for(const dir of [state,library,backupDir])await fs.mkdir(dir,{recursive:true});
await cleanPreviewWorkers(data);
let jobs=await readJSON(path.join(state,'jobs.json'),[]), active=null;
for(const job of jobs)if(['queued','running'].includes(job.state)){job.state='interrupted';job.message='Controller restarted during this operation. Check server status before retrying.';}
await writeJSON(path.join(state,'jobs.json'),jobs);
// A controller restart can interrupt an export before its finally block runs.
// Stop only the isolated worker belonging to that recorded job before retrying.
for(const job of jobs)if(job.action==='refresh-map'&&job.state==='interrupted'&&/^[0-9a-f-]{36}$/.test(job.id)){
  const helper=`factorio-panel-map-${job.id}`;
  const worker=await docker('GET',`/containers/${helper}/json`).catch(error=>{if(error.status===404)return null;throw error;});
  if(worker){
    assert(worker.Config?.Labels?.['factorio-panel.job']===job.id,'Interrupted map worker label does not match its job.');
    if(worker.State.Running)await docker('POST',`/containers/${helper}/stop?t=15`);
    await docker('DELETE',`/containers/${helper}`);
  }
  await fs.rm(inside(data,`.panel-work/${job.id}`),{recursive:true,force:true});
}
let schedule=await readJSON(path.join(state,'schedule.json'),{enabled:false,hours:6,keep:12,lastRun:null});
let validations=await readJSON(path.join(state,'backup-validation.json'),{});
const autoMapFile=path.join(state,'map-refresh.json');
const autoMap=new SaveMapQueue(await readJSON(autoMapFile,{}),{debounceMs:Number(process.env.MAP_SAVE_DEBOUNCE_MS||2000)});
let autoMapWrites=Promise.resolve(),autoMapSaved=null,autoMapPolling=false;
function persistAutoMap(){
  autoMapWrites=autoMapWrites.catch(()=>{}).then(async()=>{const value=JSON.stringify(autoMap);if(value!==autoMapSaved){await writeJSON(autoMapFile,JSON.parse(value));autoMapSaved=value;}});return autoMapWrites;
}
const info=()=>docker('GET',`/containers/${container}/json`);
const control=action=>docker('POST',`/containers/${container}/${action}${action==='stop'||action==='restart'?'?t=120':''}`);
const logFile=path.join(data,'factorio-current.log');
const worldPreviews=new WorldPreviews({canRun:()=>!active,render:async input=>{const server=await info();assert((server.Image||server.Config.Image)===input.image,'Factorio changed. Refresh this preview.');return renderWorldPreview(input,{data,server});}});
setInterval(()=>void worldPreviews.tick(),500).unref();
const livePlayersFile=path.join(state,'live-players.json');
const livePlayers=new LivePlayers({config:await readJSON(livePlayersFile,{enabled:false}),query:rcon,persist:config=>writeJSON(livePlayersFile,config),scope:async()=>{
  const server=await info();
  if(!server.State.Running||active&&['switch','restore','settings','restart','stop','start'].includes(active.action))return {running:false};
  const world=await activeSave(),value=await rcon('/seed'),seed=Number(value.match(/\d+/)?.[0]);assert(Number.isFinite(seed),'Factorio seed is unavailable.');return {running:true,world,seed};
}});
async function logText(){try{return await fs.readFile(logFile,'utf8');}catch{return '';}}
async function activeSave(){
  const log=await logText();const matches=[...log.matchAll(/Loading map \/factorio\/saves\/([^\r\n]+?\.zip):/g)];
  if(matches.length)return path.basename(matches.at(-1)[1]);
  const list=await listFiles(saves,0);return list.filter(x=>x.relative.endsWith('.zip')).sort((a,b)=>b.modified.localeCompare(a.modified))[0]?.relative||null;
}
async function listFiles(root,depth=3,prefix=''){
  const result=[];let entries;try{entries=await fs.readdir(path.join(root,prefix),{withFileTypes:true});}catch{return result;}
  for(const entry of entries){
    if(entry.isSymbolicLink())continue;
    const relative=path.posix.join(prefix,entry.name);
    if(entry.isDirectory()&&depth>0)result.push(...await listFiles(root,depth-1,relative));
    else if(entry.isFile()){const stat=await fs.stat(path.join(root,relative));result.push({relative,size:stat.size,modified:stat.mtime.toISOString()});}
  }return result;
}
function fileId(kind,relative){return Buffer.from(`${kind}:${relative}`).toString('base64url');}
async function resolveWorld(id){
  let value;try{value=Buffer.from(String(id),'base64url').toString('utf8');}catch{throw new HttpError(400,'Invalid world.');}
  const colon=value.indexOf(':'),kind=value.slice(0,colon),relative=value.slice(colon+1);
  assert(['active','archive'].includes(kind)&&relative.endsWith('.zip'),'Invalid world.');
  if(kind==='archive')assert(!relative.startsWith('panel-backups/'),'Use backup restore for full backup archives.');
  return {file:await existingFile(kind==='active'?saves:backups,relative),name:path.basename(relative),kind};
}
async function worlds(){
  const current=await activeSave();const result=[];
  for(const file of await listFiles(saves,0))if(file.relative.endsWith('.zip'))result.push({...file,id:fileId('active',file.relative),name:path.basename(file.relative,'.zip'),kind:file.relative.startsWith('_autosave')?'autosave':'active',current:file.relative===current});
  for(const file of await listFiles(backups,4))if(file.relative.endsWith('.zip')&&!file.relative.startsWith('panel-backups/')&&!file.relative.includes('/.'))result.push({...file,id:fileId('archive',file.relative),name:path.basename(file.relative,'.zip'),kind:'archive',current:false});
  return result.sort((a,b)=>Number(b.current)-Number(a.current)||b.modified.localeCompare(a.modified));
}
async function backupList(){return (await listFiles(backupDir,0)).filter(file=>file.relative.endsWith('.zip')).map(file=>({...file,validation:validations[file.relative]?.size===file.size&&validations[file.relative]?.modified===file.modified?validations[file.relative]:null})).sort((a,b)=>b.modified.localeCompare(a.modified));}
async function verifyBackup(name){
  const file=await existingFile(backupDir,name),stat=await fs.stat(file);let result;
  try{const buffer=await fs.readFile(file);result={ok:true,...validateBackup(buffer),sha256:crypto.createHash('sha256').update(buffer).digest('hex')};}
  catch(error){result={ok:false,error:redact(error.message)};}
  validations[name]={...result,size:stat.size,modified:stat.mtime.toISOString(),checked:new Date().toISOString()};
  await writeJSON(path.join(state,'backup-validation.json'),validations);
  assert(result.ok,result.error);return `Backup integrity verified: ${result.worlds} world saves and ${result.files} files. This checks archive contents, not a game-load restore.`;
}
async function backupHealth(items){let storage=null;try{const disk=await fs.statfs(backupDir);storage={freeBytes:disk.bavail*disk.bsize,totalBytes:disk.blocks*disk.bsize};}catch{}return summarizeBackups(items,schedule,jobs,storage);}
async function saveNow(){
  const before=(await fs.stat(logFile).catch(()=>({size:0}))).size;
  const output=await rcon('/server-save');assert(!/cannot|error/i.test(output),output||'Save request failed.',409);
  for(let i=0;i<120;i++){
    const log=await logText();
    if(/Saving finished|Saving progress: 100/.test(log.slice(before)))return 'World saved successfully.';
    await sleep(500);
  }throw new HttpError(504,'Save was requested but completion could not be confirmed.');
}
async function ready(name=container){
  const deadline=Date.now()+Number(process.env.FACTORIO_READY_TIMEOUT_MS||60000);
  while(Date.now()<deadline){
    try{const value=await rcon('/version',name);if(/2\.\d+\.\d+/.test(value))return value;}catch{}
    await sleep(Math.min(1000,Math.max(0,deadline-Date.now())));
  }throw new HttpError(504,'Factorio did not become ready within 60 seconds.');
}
async function backup(label='manual',{save=true}={}){
  if(save&&(await info()).State.Running)await saveNow();
  const files=[];
  for(const subdir of ['saves','config','mods'])for(const item of await listFiles(path.join(data,subdir),4)){
    if(item.relative.endsWith('.tmp.zip'))continue;
    files.push({name:`${subdir}/${item.relative}`,data:await fs.readFile(await existingFile(data,`${subdir}/${item.relative}`))});
  }
  files.push({name:'panel-manifest.json',data:Buffer.from(JSON.stringify({version:1,created:new Date().toISOString(),activeSave:await activeSave(),label}))});
  const name=`${stamp()}-${safeName(label)}.zip`;
  const target=path.join(backupDir,name),temporary=target+'.tmp';
  try{await fs.writeFile(temporary,makeZip(files),{flag:'wx'});await fs.rename(temporary,target);}finally{await fs.unlink(temporary).catch(()=>{});}
  await verifyBackup(name);
  return name;
}
async function setJob(job,updates){Object.assign(job,updates);await writeJSON(path.join(state,'jobs.json'),jobs);}
async function runJob(action,params,actor){
  assert(!active,'Another operation is in progress. Please wait.',409);
  const job={id:crypto.randomUUID(),action,actor,started:new Date().toISOString(),state:'running',message:'Starting…'};
  active=job;jobs.unshift(job);jobs=jobs.slice(0,100);await writeJSON(path.join(state,'jobs.json'),jobs);
  void (async()=>{
    try{if(worldPreviews.running)await stageMessage(job,'Waiting for the current map preview to finish…');await worldPreviews.waitIdle();const result=await actions[action](params,job);await setJob(job,{state:'succeeded',message:typeof result==='string'?result:'Completed.',result,finished:new Date().toISOString()});}
    catch(error){await setJob(job,{state:'failed',message:redact(error.message),finished:new Date().toISOString()});}
    finally{
      if(action==='refresh-map'&&params.automatic){autoMap.finish(params.automatic,job.state==='succeeded',job.state==='failed'?job.message:null);await persistAutoMap().catch(error=>console.error('Map queue persistence failed:',redact(error.message)));}
      active=null;
    }
  })();return job;
}
async function stageMessage(job,message){await setJob(job,{message});}
async function switchWorld(params,job){
  assert(params.confirm===true,'Confirm the world change first.');
  const selected=await resolveWorld(params.id),buffer=await fs.readFile(selected.file);validateWorld(buffer);
  const oldCurrent=await activeSave();const wasRunning=(await info()).State.Running;
  const archive=path.join(library,`before-switch-${stamp()}`);let moved=false;
  await stageMessage(job,'Saving and backing up the current world…');
  if(livePlayers.config.enabled)await livePlayers.configure({enabled:false},'World switch');
  if(wasRunning)await control('stop');
  try{
    const backupName=await backup('before-world-switch',{save:false});
    await fs.mkdir(archive,{recursive:true});
    for(const entry of await fs.readdir(saves,{withFileTypes:true}))if(entry.isFile()&&entry.name.endsWith('.zip'))await fs.rename(path.join(saves,entry.name),path.join(archive,entry.name));
    moved=true;
    const name=selected.name.startsWith('_autosave')?`Restored-${stamp()}.zip`:selected.name;
    await fs.writeFile(path.join(saves,name),buffer,{flag:'wx'});
    await stageMessage(job,'Starting the selected world…');await control('start');await ready();
    return `Now running ${path.basename(name,'.zip')}. Previous world backed up as ${backupName}.`;
  }catch(error){
    if(moved){
      await control('stop').catch(()=>{});
      const failed=path.join(library,`failed-switch-${stamp()}`);await fs.mkdir(failed,{recursive:true});
      for(const entry of await fs.readdir(saves,{withFileTypes:true}))if(entry.isFile()&&entry.name.endsWith('.zip'))await fs.rename(path.join(saves,entry.name),path.join(failed,entry.name));
      for(const entry of await fs.readdir(archive))await fs.copyFile(path.join(archive,entry),path.join(saves,entry));
      if(oldCurrent)await fs.utimes(path.join(saves,oldCurrent),new Date(),new Date()).catch(()=>{});
    }
    if(wasRunning)await control('start').catch(()=>{});
    throw new Error(`World switch failed. The previous saves were restored. ${error.message}`);
  }
}
async function restoreBackup(params,job){
  assert(params.confirm===true,'Confirm the backup restore first.');
  const file=await existingFile(backupDir,params.name),entries=zipEntries(await fs.readFile(file));
  validateBackup(await fs.readFile(file));
  assert(entries.some(e=>e.name.startsWith('saves/')&&e.name.endsWith('.zip')),'Backup has no world saves.');
  for(const entry of entries)assert(entry.name==='panel-manifest.json'||/^(saves|config|mods)\//.test(entry.name),'Unexpected file in backup.');
  // Validate and inflate everything before touching the live server.
  const extracted=entries.filter(e=>!e.name.endsWith('/')).map(e=>({name:e.name,data:e.read()}));
  const manifestEntry=extracted.find(e=>e.name==='panel-manifest.json');
  const manifest=manifestEntry?JSON.parse(manifestEntry.data):{};
  const wasRunning=(await info()).State.Running,archive=path.join(backups,`panel-before-restore-${stamp()}`);const moved=[];
  await stageMessage(job,'Saving the current state before restoring…');if(livePlayers.config.enabled)await livePlayers.configure({enabled:false},'Backup restore');if(wasRunning)await control('stop');
  try{
    await backup('before-backup-restore',{save:false});await fs.mkdir(archive,{recursive:true});
    for(const subdir of ['saves','config','mods']){await fs.rename(path.join(data,subdir),path.join(archive,subdir));moved.push(subdir);await fs.mkdir(path.join(data,subdir));}
    for(const entry of extracted)if(entry.name!=='panel-manifest.json'){
      const target=inside(data,entry.name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,entry.data);
    }
    if(manifest.activeSave)await fs.utimes(inside(saves,manifest.activeSave),new Date(),new Date());
    await control('start');await ready();return 'Backup restored. The previous state is preserved in the backup library.';
  }catch(error){
    if(moved.length){await control('stop').catch(()=>{});const failed=path.join(backups,`panel-failed-restore-${stamp()}`);await fs.mkdir(failed,{recursive:true});
      for(const subdir of moved){if(await fs.stat(path.join(data,subdir)).catch(()=>null))await fs.rename(path.join(data,subdir),path.join(failed,subdir));await fs.rename(path.join(archive,subdir),path.join(data,subdir));}}
    if(wasRunning)await control('start').catch(()=>{});throw new Error(`Restore failed; previous data was recovered. ${error.message}`);
  }
}
const EXPORT_LUA='/silent-command local original = helpers.parse_map_exchange_string(game.get_map_exchange_string()); local difficulty = original.map_settings.difficulty_settings; original.map_settings.difficulty_settings = nil; local function plain(template,live) local out = {}; for key,value in pairs(template) do if type(value) == "table" then out[key] = plain(value,live[key]) else out[key] = live[key] end end; return out end; local settings = plain(original.map_settings,game.map_settings); settings.difficulty_settings = plain(difficulty,game.difficulty_settings); helpers.write_file("export-settings.json",helpers.table_to_json({map_gen_settings=game.surfaces["nauvis"].map_gen_settings,map_settings=settings})); rcon.print("Settings exported.")';
async function createWorld(params,job,{optionsOnly=false}={}){
  const configuration=params.configuration===undefined?null:validateConfiguration(params.configuration);
  const extract=optionsOnly||!configuration;
  const name=safeName(params.name||`NewWorld-${new Date().toISOString().slice(0,10)}`),destination=path.join(library,`${name}.zip`);
  if(!optionsOnly)assert(!await fs.stat(destination).catch(()=>null),'A world with this name already exists.');
  let seed=params.seed===''||params.seed==null?crypto.randomInt(1,0x100000000):Number(params.seed);
  assert(Number.isInteger(seed)&&seed>0&&seed<=0xffffffff,'Seed must be an integer between 1 and 4294967295.');
  const settings=await readJSON(settingsFile,{});const server=await info();
  if(extract){assert(server.State.Running,'Start Factorio first so its current world settings can be copied.',409);
    await stageMessage(job,'Saving a copy of the current world…');await saveNow();}
  const source=await activeSave(),relative=`.panel-work/${job.id}`,work=inside(data,relative);
  for(const dir of ['saves','mods','config'])await fs.mkdir(path.join(work,dir),{recursive:true});
  if(extract)await fs.copyFile(await existingFile(saves,source),path.join(work,'saves/source.zip'));
  for(const item of await listFiles(path.join(data,'mods'),1)){const target=inside(path.join(work,'mods'),item.relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(await existingFile(path.join(data,'mods'),item.relative),target);}
  await writeJSON(path.join(work,'config/server-settings.json'),{...settings,name:'Isolated map settings export',visibility:{public:false,lan:false},auto_pause:true});
  const mount=server.Mounts.find(m=>m.Destination==='/factorio');assert(mount?.Type==='bind','World creation requires the existing bind-mounted Factorio data directory.');
  let hostRoot=mount.Source.replace(/\\/g,'/');
  if(/^[A-Za-z]:\//.test(hostRoot))hostRoot='/run/desktop/mnt/host/'+hostRoot[0].toLowerCase()+hostRoot.slice(2);
  const hostSource=hostRoot.replace(/\/$/,'')+'/'+relative;
  const helper=`factorio-panel-job-${job.id}`;let helperExists=false;
  const mountConfig={Type:'bind',Source:hostSource,Target:'/factorio'};
  try{
    let exported=configuration;
    if(extract){
    await stageMessage(job,'Extracting settings from an isolated copy…');
    await docker('POST',`/containers/create?name=${helper}`,{Image:server.Config.Image,Env:['DLC_SPACE_AGE=false','UPDATE_MODS_ON_START=false','LOAD_LATEST_SAVE=false','SAVE_NAME=source'],Labels:{'factorio-panel.job':job.id},HostConfig:{NetworkMode:'none',Mounts:[mountConfig],Memory:1073741824}});helperExists=true;
    await docker('POST',`/containers/${helper}/start`);await ready(helper);
    await rcon(EXPORT_LUA,helper);await rcon(EXPORT_LUA,helper);
    exported=validateConfiguration(await readJSON(path.join(work,'script-output/export-settings.json'),null),{limits:false});
    await docker('POST',`/containers/${helper}/stop?t=30`);await docker('DELETE',`/containers/${helper}`);helperExists=false;
    }
    if(optionsOnly){await writeJSON(path.join(state,'world-options.json'),{sourceWorld:source,image:server.Config.Image,created:new Date().toISOString(),configuration:exported});return 'Current world settings are ready to customize.';}
    exported=validateConfiguration(exported);
    // Factorio requires every member of gameplay subtrees such as pollution.
    // Fill omitted advanced tuning from this exact installed game image.
    exported.map_settings=mergeSettings(await engineMapSettings(container,server.Image||server.Config.Image),exported.map_settings);
    if(params.seed==null||params.seed==='')while(seed===exported.map_gen_settings.seed)seed=crypto.randomInt(1,0x100000000);
    exported.map_gen_settings.seed=seed;
    await writeJSON(path.join(work,'config/new-map-gen-settings.json'),exported.map_gen_settings);await writeJSON(path.join(work,'config/new-map-settings.json'),exported.map_settings);
    await stageMessage(job,`Generating a new world with seed ${seed}…`);
    await docker('POST',`/containers/create?name=${helper}`,{Image:server.Config.Image,Entrypoint:['/opt/factorio/bin/x64/factorio'],Cmd:['--create','/factorio/saves/generated.zip','--map-gen-settings','/factorio/config/new-map-gen-settings.json','--map-settings','/factorio/config/new-map-settings.json','--mod-directory','/factorio/mods'],Labels:{'factorio-panel.job':job.id},HostConfig:{NetworkMode:'none',Mounts:[mountConfig],Memory:1073741824}});helperExists=true;
    await docker('POST',`/containers/${helper}/start`);
    const result=await docker('POST',`/containers/${helper}/wait?condition=not-running`,undefined,{timeout:180000});
    assert(result.StatusCode===0,'Factorio could not generate the world.');
    const generated=await fs.readFile(path.join(work,'saves/generated.zip'));validateWorld(generated);await fs.writeFile(destination,generated,{flag:'wx'});
    await writeJSON(path.join(library,`${name}.settings.json`),{...exported,seed,source,created:new Date().toISOString()});
    await docker('DELETE',`/containers/${helper}`);helperExists=false;
    // A preview is generated separately, without opening or scripting the fresh save.
    if(params.preview!==false){
      await stageMessage(job,'Creating the map preview…');
      await docker('POST',`/containers/create?name=${helper}`,{Image:server.Config.Image,Entrypoint:['/opt/factorio/bin/x64/factorio'],Cmd:['--generate-map-preview','/factorio/preview.png','--map-preview-size','1024','--map-gen-settings','/factorio/config/new-map-gen-settings.json','--mod-directory','/factorio/mods'],Labels:{'factorio-panel.job':job.id},HostConfig:{NetworkMode:'none',Mounts:[mountConfig],Memory:1073741824}});helperExists=true;
      await docker('POST',`/containers/${helper}/start`);await docker('POST',`/containers/${helper}/wait?condition=not-running`,undefined,{timeout:180000});
      const preview=await fs.readFile(path.join(work,'preview.png')).catch(()=>null);if(preview)await fs.writeFile(path.join(library,`${name}.png`),preview);
    }
    if(params.activate){assert(params.confirm===true,'Confirm switching to the new world.');await switchWorld({id:fileId('archive',`panel-worlds/${name}.zip`),confirm:true},job);}
    return `Created ${name} with seed ${seed}, using ${configuration?'your chosen':'copied'} settings.${params.activate?' The new world is now running.':' The current world is still running.'}`;
  }finally{
    if(helperExists){await docker('POST',`/containers/${helper}/stop?t=15`).catch(()=>{});await docker('DELETE',`/containers/${helper}`).catch(()=>{});}
    // Work is contained beneath .panel-work; real worlds and backups are elsewhere.
    await fs.rm(work,{recursive:true,force:true}).catch(()=>{});
  }
}
async function settingsUpdate(params){
  assert(params.confirm===true,'Confirm applying settings and restarting.');
  const current=await readJSON(settingsFile,{}),next={...current};
  for(const key of ['name','description'])if(key in params){assert(typeof params[key]==='string'&&params[key].length<=(key==='name'?100:500),`Invalid ${key}.`);next[key]=params[key];}
  for(const [key,min,max] of [['max_players',0,1000],['autosave_interval',1,60],['autosave_slots',1,100]])if(key in params){assert(Number.isInteger(params[key])&&params[key]>=min&&params[key]<=max,`Invalid ${key}.`);next[key]=params[key];}
  for(const key of ['auto_pause','require_user_verification'])if(key in params){assert(typeof params[key]==='boolean',`Invalid ${key}.`);next[key]=params[key];}
  if(params.game_password){assert(typeof params.game_password==='string'&&params.game_password.length<=100,'Password is too long.');next.game_password=params.game_password;}
  if(params.clear_password)next.game_password='';
  next.visibility={public:false,lan:true};
  const running=(await info()).State.Running;if(running)await control('stop');
  try{await backup('before-settings-change',{save:false});await writeJSON(settingsFile,next);if(running){await control('start');await ready();}}
  catch(error){await writeJSON(settingsFile,current);if(running)await control('start').catch(()=>{});throw error;}
  return 'Server settings saved.';
}
const actions={
  save:()=>saveNow(),
  start:async()=>{await control('start');await ready();return 'Factorio is running.';},
  stop:async params=>{assert(params.confirm===true,'Confirm stopping the server.');await control('stop');return 'Factorio stopped and saved.';},
  restart:async params=>{assert(params.confirm===true,'Confirm restarting the server.');await control('restart');await ready();return 'Factorio restarted and loaded its latest save.';},
  backup:async(params,job)=>`Backup created: ${await backup(job?.actor==='scheduled backup'?'scheduled':'manual')}`,
  'verify-backup':params=>verifyBackup(params.name),
  'live-tracking':async(params,job)=>{
    await livePlayers.validate(params);
    if(params.enabled){await stageMessage(job,'Backing up the world before enabling live tracking…');await backup('before-live-player-tracking');}
    await livePlayers.configure(params,job.actor);
    if(params.enabled){const sample=await livePlayers.get();assert(sample.state==='live','Live tracking is configured but positions are unavailable. The map will retry.');}
    return params.enabled?'Live player tracking enabled for this world. Lua console use disables achievements.':'Live player tracking disabled. This does not restore achievements already disabled.';
  },
  'refresh-map':async(params,job)=>{
    const server=await info(),world=await activeSave(),automatic=params.automatic;
    assert(!automatic||automatic.world===world,'The active world changed before map export.');
    return exportMap({data,state,server,world,source:automatic?.source||world,save:!automatic,expectedVersion:automatic?.version,saveNow,ready,running:server.State.Running,listFiles,job,stageMessage});
  },
  switch:switchWorld,restore:restoreBackup,create:createWorld,'world-options':(params,job)=>createWorld({},job,{optionsOnly:true}),settings:settingsUpdate,
  player:async params=>{
    const commands={kick:'/kick',ban:'/ban',unban:'/unban',promote:'/promote',demote:'/demote',whitelist:'/whitelist add',unwhitelist:'/whitelist remove'};
    assert(commands[params.operation],'Unsupported player action.');assert(typeof params.name==='string'&&/^[\p{L}\p{N}_ .-]{1,64}$/u.test(params.name),'Invalid player name.');
    return await rcon(`${commands[params.operation]} ${params.name}`)||'Player list updated.';
  },
  announce:async params=>{assert(typeof params.message==='string'&&params.message.length>0&&params.message.length<=250&&!/[\r\n\x00]/.test(params.message),'Enter a message up to 250 characters.');return await rcon(`/shout ${params.message}`)||'Announcement sent.';},
  console:async params=>{assert(['/players','/time','/seed','/version','/evolution','/admins','/bans','/whitelist get','/help'].includes(params.command),'Choose one of the supported administrative commands.');return await rcon(params.command);},
};
let statusCache=null,statusAt=0,previousCpu=null;
async function status(){
  if(statusCache&&Date.now()-statusAt<3000)return statusCache;
  const server=await info(),settings=await readJSON(settingsFile,{}),running=server.State.Running;
  let players=[],playtime='',seed='',version='',rconReady=false;
  if(running)try{
    const output=await rcon('/players online');players=output.split('\n').filter(line=>/^\s+\S/.test(line)).map(line=>line.trim().replace(/ \(online\)$/,''));
    playtime=await rcon('/time');seed=await rcon('/seed');version=await rcon('/version');rconReady=true;
  }catch{}
  let cpu=null,memory=null;
  try{if(running){const stats=await docker('GET',`/containers/${container}/stats?stream=false&one-shot=true`);
    const sample={total:stats.cpu_stats?.cpu_usage?.total_usage,system:stats.cpu_stats?.system_cpu_usage};
    const prior=stats.precpu_stats?.system_cpu_usage?{total:stats.precpu_stats.cpu_usage.total_usage,system:stats.precpu_stats.system_cpu_usage}:previousCpu;
    const total=prior?sample.total-prior.total:0,system=prior?sample.system-prior.system:0;
    cpu=system>0?Math.max(0,total/system*(stats.cpu_stats.online_cpus||1)*100):null;previousCpu=sample;memory=stats.memory_stats?.usage||null;}}
  catch{}
  const log=await logText(),saveEvents=[...log.matchAll(/([\d.]+) (?:Info AppManagerStates[^\n]*Saving finished|Info MainLoop[^\n]*Saving progress: 100)/g)];
  const latestEvent=saveEvents.at(-1),started=new Date(server.State.StartedAt).getTime();
  const lastSave=latestEvent?new Date(started+Number(latestEvent[1])*1000).toISOString():null;
  const saveFiles=await listFiles(saves,0),latestFile=saveFiles.filter(x=>x.relative.endsWith('.zip')).sort((a,b)=>b.modified.localeCompare(a.modified))[0];
  const lastSaveAt=lastSave||latestFile?.modified||null;
  statusCache={state:server.State.Status,running,ready:rconReady,paused:running&&rconReady&&players.length===0&&settings.auto_pause,players,playtime,seed,version:version||server.Config.Image.split(':').at(-1),image:server.Config.Image,currentWorld:await activeSave(),lastSaveAt,saveVerified:!!lastSave,cpu,memory,autosaveMinutes:settings.autosave_interval,autosaveSlots:settings.autosave_slots,autoPause:settings.auto_pause,connection:process.env.GAME_ADDRESS||'localhost:34197',name:settings.name,activeJob:active,schedule};statusAt=Date.now();return statusCache;
}
async function handle(req,res){
  if(req.url==='/health')return json(res,200,{ok:true});
  assert(equalSecret(req.headers.authorization,`Bearer ${token}`),'Unauthorized.',401);
  const url=new URL(req.url,'http://controller');
  if(req.method==='GET'&&url.pathname==='/status')return json(res,200,await status());
  if(['/world-preview','/world-preview-image'].includes(url.pathname)){
    const owner=req.headers['x-panel-user'];assert(typeof owner==='string'&&/^[A-Za-z0-9][A-Za-z0-9_\-]{2,31}$/.test(owner),'Preview needs an administrator session.',403);
    if(req.method==='GET'&&url.pathname==='/world-preview')return json(res,200,worldPreviews.status(owner));
    if(req.method==='GET'&&url.pathname==='/world-preview-image'){const png=worldPreviews.image(owner,url.searchParams.get('id'));res.writeHead(200,{'content-type':'image/png','cache-control':'no-store','content-length':png.length});return res.end(png);}
    assert(req.method==='POST'&&url.pathname==='/world-preview','Not found.',404);
    const body=await requestJSON(req),configuration=validateConfiguration(body.configuration),seed=Number(body.seed);
    assert(Number.isInteger(seed)&&seed>=1&&seed<=0xffffffff,'Choose a seed between 1 and 4294967295.');
    const server=await info();return json(res,202,worldPreviews.request(owner,{configuration,seed,image:server.Image||server.Config.Image}));
  }
  if(req.method==='GET'&&url.pathname==='/world-options'){const copied=await readJSON(path.join(state,'world-options.json'),null);return json(res,200,{defaults:worldDefaults,copied,currentWorld:await activeSave(),image:(await info()).Config.Image});}
  if(req.method==='GET'&&url.pathname==='/worlds')return json(res,200,{worlds:await worlds()});
  if(req.method==='GET'&&url.pathname==='/backups'){const items=await backupList();return json(res,200,{backups:items,schedule,health:await backupHealth(items)});}
  if(req.method==='GET'&&url.pathname==='/map'){
    const snapshot=await readJSON(path.join(state,'map.json'),null);
    if(!snapshot)return json(res,200,{snapshot:null,pins:[],automatic:autoMap.status()});
    const current=await activeSave();return json(res,200,{snapshot,automatic:autoMap.status(),staleWorld:snapshot.world!==current,pins:(await readJSON(path.join(state,'map-pins.json'),[])).filter(pin=>pin.world===snapshot.world&&pin.seed===snapshot.seed)});
  }
  if(req.method==='GET'&&url.pathname==='/map-status'){
    const snapshot=await readJSON(path.join(state,'map.json'),null);return json(res,200,{created:snapshot?.created||null,automatic:autoMap.status(),active:active?.action==='refresh-map'?{message:active.message}:null});
  }
  if(req.method==='GET'&&url.pathname==='/live-players')return json(res,200,await livePlayers.get());
  if(req.method==='POST'&&url.pathname==='/pins'){
    const body=await requestJSON(req),snapshot=await readJSON(path.join(state,'map.json'),null);assert(snapshot,'Generate a map first.');
    let pins=await readJSON(path.join(state,'map-pins.json'),[]);
    if(body.remove){assert(typeof body.remove==='string','Invalid pin.');pins=pins.filter(pin=>pin.id!==body.remove);}
    else{
      assert(typeof body.label==='string'&&body.label.trim().length>0&&body.label.length<=80&&Number.isFinite(body.x)&&Number.isFinite(body.y),'Enter a label and valid coordinates.');
      assert(snapshot.chunks.some(chunk=>Math.floor(body.x/32)===chunk.x&&Math.floor(body.y/32)===chunk.y),'Pins must be inside the exported explored area.');
      assert(pins.length<200,'Remove an old pin before adding another.');pins.push({id:crypto.randomUUID(),world:snapshot.world,seed:snapshot.seed,label:body.label.trim(),x:body.x,y:body.y});
    }
    await writeJSON(path.join(state,'map-pins.json'),pins);return json(res,200,{ok:true});
  }
  if(req.method==='GET'&&url.pathname==='/jobs')return json(res,200,{jobs,active});
  if(req.method==='GET'&&url.pathname==='/settings'){
    const value=await readJSON(settingsFile,{});return json(res,200,{name:value.name,description:value.description,max_players:value.max_players,autosave_interval:value.autosave_interval,autosave_slots:value.autosave_slots,auto_pause:value.auto_pause,require_user_verification:value.require_user_verification,passwordSet:!!value.game_password});
  }
  if(req.method==='GET'&&url.pathname==='/logs')return json(res,200,{text:redact((await logText()).split('\n').slice(-250).join('\n'))});
  if(req.method==='GET'&&url.pathname==='/download'){
    let file,name;
    if(url.searchParams.get('kind')==='backup'){name=url.searchParams.get('name');file=await existingFile(backupDir,name);}
    else{const world=await resolveWorld(url.searchParams.get('id'));file=world.file;name=world.name;}
    const buffer=await fs.readFile(file);res.writeHead(200,{'content-type':'application/zip','content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name)}`,'content-length':buffer.length});return res.end(buffer);
  }
  if(req.method==='GET'&&url.pathname==='/preview'){
    const world=await resolveWorld(url.searchParams.get('id'));assert(world.kind==='archive','No preview available.',404);
    const relative=path.relative(backups,world.file).replace(/\.zip$/i,'.png');const buffer=await fs.readFile(await existingFile(backups,relative));res.writeHead(200,{'content-type':'image/png'});return res.end(buffer);
  }
  if(req.method==='POST'&&url.pathname==='/jobs'){
    const body=await requestJSON(req);assert(Object.hasOwn(actions,body.action),'Unsupported action.');
    if(body.action==='create'&&body.params?.configuration!==undefined)validateConfiguration(body.params.configuration);
    if(body.action==='refresh-map')assert(!body.params||Object.keys(body.params).length===0,'Manual map refresh does not accept source overrides.');
    if(body.action==='live-tracking'&&body.params?.enabled)assert(body.params.confirm===true,'Acknowledge that live tracking disables achievements.');
    if(['switch','restore','stop','restart','settings'].includes(body.action)||body.action==='create'&&body.params?.activate)assert(body.params?.confirm===true,'This action requires confirmation.');
    return json(res,202,await runJob(body.action,body.params||{},body.actor||'admin'));
  }
  if(req.method==='POST'&&url.pathname==='/schedule'){
    const value=await requestJSON(req);assert(typeof value.enabled==='boolean'&&Number.isInteger(value.hours)&&value.hours>=1&&value.hours<=168&&Number.isInteger(value.keep)&&value.keep>=2&&value.keep<=100,'Invalid backup schedule.');
    schedule={...schedule,enabled:value.enabled,hours:value.hours,keep:value.keep};await writeJSON(path.join(state,'schedule.json'),schedule);return json(res,200,{schedule});
  }
  if(req.method==='POST'&&url.pathname==='/upload'){
    assert(!active,'Wait for the current operation before uploading.',409);const name=safeName(url.searchParams.get('name'));
    const target=path.join(library,`${name}.zip`),buffer=await readBody(req,128*1024*1024);validateWorld(buffer);await fs.writeFile(target,buffer,{flag:'wx'}).catch(error=>{if(error.code==='EEXIST')throw new HttpError(409,'A world with this name already exists.');throw error;});
    return json(res,201,{message:'World uploaded to the library. The current world was not changed.'});
  }
  throw new HttpError(404,'Not found.');
}
const server=http.createServer((req,res)=>handle(req,res).catch(error=>{if(!res.headersSent)json(res,error.status||500,{error:redact(error.message)});else res.end();}));
server.requestTimeout=300000;server.listen(Number(process.env.PORT||8081),'0.0.0.0',()=>console.log('Internal Factorio controller ready.'));
async function pollSavedMap(){
  if(autoMapPolling)return;autoMapPolling=true;
  try{
    const event=completedSave(await logText()),snapshot=await readJSON(path.join(state,'map.json'),null);
    if(event.completed&&!event.saving){
      const item=event.completed,file=await existingFile(saves,item.source).catch(()=>null);
      if(file){const stat=await fs.stat(file);autoMap.observe({...item,version:saveVersion(item.world,item.source,stat)},snapshot);}
    }
    if(!active&&!event.saving&&autoMap.pending){
      const item=autoMap.pending,file=await existingFile(saves,item.source).catch(()=>null);
      if(!file||item.world!==await activeSave()||saveVersion(item.world,item.source,await fs.stat(file))!==item.version)autoMap.pending=null;
      const task=autoMap.claim(false);
      if(task){try{await persistAutoMap();await runJob('refresh-map',{automatic:task},'automatic map refresh');}catch(error){autoMap.finish(task,false,redact(error.message));}}
    }
    await persistAutoMap();
  }catch(error){console.error('Save-triggered map refresh:',redact(error.message));}
  finally{autoMapPolling=false;}
}
setInterval(pollSavedMap,Number(process.env.MAP_SAVE_POLL_MS||2000)).unref();
await pollSavedMap();
setInterval(async()=>{
  if(!schedule.enabled||active)return;
  const elapsed=Date.now()-new Date(schedule.lastRun||Date.now()).getTime();
  if(!schedule.lastRun){schedule.lastRun=new Date().toISOString();await writeJSON(path.join(state,'schedule.json'),schedule);return;}
  if(elapsed<schedule.hours*3600000)return;
  try{
    const job=await runJob('backup',{},'scheduled backup');
    while(['queued','running'].includes(job.state))await sleep(1000);
    schedule.lastRun=new Date().toISOString();await writeJSON(path.join(state,'schedule.json'),schedule);
    if(job.state==='succeeded')for(const file of (await backupList()).filter(item=>item.relative.endsWith('-scheduled.zip')).slice(schedule.keep))await fs.unlink(await existingFile(backupDir,file.relative));
  }catch(error){console.error('Scheduled backup failed:',redact(error.message));}
},60000).unref();
