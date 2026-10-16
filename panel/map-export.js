import fs from 'node:fs/promises';
import path from 'node:path';
import {docker,rcon,gameContainerRoute} from './docker.js';
import {assert,writeJSON,readJSON,inside,existingFile} from './common.js';
import {saveVersion} from './save-map.js';

const init=(await fs.readFile(new URL('./map-init.lua',import.meta.url),'utf8')).replace(/\s+/g,' ');
const batch=(await fs.readFile(new URL('./map-batch.lua',import.meta.url),'utf8')).replace(/\s+/g,' ');
export function validateMap(value){
  assert(value?.version===1&&Array.isArray(value.chunks)&&value.chunks.length<=2048&&Array.isArray(value.entities)&&value.entities.length<=80000&&Array.isArray(value.palette)&&value.palette.length<1000,'Invalid map export.');
  assert(value.step===2&&Number.isFinite(value.seed),'Invalid map metadata.');
  for(const item of [...value.palette,...value.entities])assert(Array.isArray(item.color)&&item.color.length===3&&item.color.every(component=>Number.isInteger(component)&&component>=0&&component<=255),'Invalid map color.');
  for(const chunk of value.chunks){
    assert(Number.isInteger(chunk.x)&&Number.isInteger(chunk.y)&&Array.isArray(chunk.tiles)&&chunk.tiles.length%2===0,'Invalid map chunk.');
    let count=0;for(let i=0;i<chunk.tiles.length;i+=2){assert(Number.isInteger(chunk.tiles[i])&&chunk.tiles[i]>0&&chunk.tiles[i]<=value.palette.length&&Number.isInteger(chunk.tiles[i+1])&&chunk.tiles[i+1]>0,'Invalid terrain run.');count+=chunk.tiles[i+1];}assert(count===256,'Incomplete map chunk.');
  }
  return value;
}
export async function exportMap({data,state,server,source,world=source,save=true,expectedVersion,saveNow,ready,running,listFiles,job,stageMessage}){
  assert(source,'No world save is available.');
  if(save&&running){await stageMessage(job,'Saving the latest progress for the map…');await saveNow();}
  const relative=`.panel-work/${job.id}`,work=inside(data,relative),helper=`factorio-panel-map-${job.id}`;
  let exists=false;
  try{
    for(const dir of ['saves','config','mods'])await fs.mkdir(path.join(work,dir),{recursive:true});
    const sourceFile=await existingFile(path.join(data,'saves'),source),sourceStat=await fs.stat(sourceFile),version=saveVersion(world,source,sourceStat);
    assert(!expectedVersion||expectedVersion===version,'The saved file changed before map export. Waiting for the latest save.');
    await fs.copyFile(sourceFile,path.join(work,'saves/source.zip'));
    assert(saveVersion(world,source,await fs.stat(sourceFile))===version,'The saved file changed while copying it. Waiting for the latest save.');
    for(const item of await listFiles(path.join(data,'mods'),1)){const target=inside(path.join(work,'mods'),item.relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(await existingFile(path.join(data,'mods'),item.relative),target);}
    const settings=await readJSON(path.join(data,'config/server-settings.json'),{});
    await writeJSON(path.join(work,'config/server-settings.json'),{...settings,name:'Isolated panel map export',visibility:{public:false,lan:false},auto_pause:true,require_user_verification:false});
    const mount=server.Mounts.find(item=>item.Destination==='/factorio');assert(mount?.Type==='bind','Map export requires the Factorio bind mount.');
    let hostRoot=mount.Source.replace(/\\/g,'/');if(/^[A-Za-z]:\//.test(hostRoot))hostRoot='/run/desktop/mnt/host/'+hostRoot[0].toLowerCase()+hostRoot.slice(2);
    await stageMessage(job,'Loading an isolated copy of the world…');
    await docker('POST',gameContainerRoute(helper),{Image:server.Image||server.Config.Image,Env:['DLC_SPACE_AGE=false','UPDATE_MODS_ON_START=false','LOAD_LATEST_SAVE=false','SAVE_NAME=source'],Labels:{'factorio-panel.job':job.id},HostConfig:{NetworkMode:'none',Mounts:[{Type:'bind',Source:hostRoot.replace(/\/$/,'')+'/'+relative,Target:'/factorio'}],Memory:1073741824}});exists=true;
    await docker('POST',`/containers/${helper}/start`);await ready(helper);
    // Factorio requires repeating the first script command to acknowledge cheats.
    // This only affects the disposable copy, never the active save.
    await rcon('/silent-command '+init,helper);const output=await rcon('/silent-command '+init,helper);
    const count=Number(output.match(/MAP_CHUNKS=(\d+)/)?.[1]);assert(Number.isInteger(count)&&count>=0&&count<=2048,'Could not read explored chunks: '+output);
    for(let i=1;i<=count;i+=16){await stageMessage(job,`Drawing explored map: ${Math.min(i+15,count)} / ${count} chunks…`);const result=await rcon('/silent-command '+batch.replaceAll('MAP_START',String(i)),helper);assert(result.includes('MAP_BATCH_OK'),'Map export failed: '+result);}
    const result=await rcon('/silent-command helpers.write_file("panel-map.json",helpers.table_to_json(storage.panel_map.output)); rcon.print("MAP_DONE")',helper);assert(result.includes('MAP_DONE'),'Could not finish map export.');
    const file=path.join(work,'script-output/panel-map.json');assert((await fs.stat(file)).size<=24*1024*1024,'Map export exceeds the 24 MB limit.');
    const value=await readJSON(file,null);for(const key of ['chunks','palette','entities','players','tags'])if(value[key]&&!Array.isArray(value[key])&&Object.keys(value[key]).length===0)value[key]=[];
    validateMap(value);Object.assign(value,{world,sourceFile:source,sourceVersion:version,created:new Date().toISOString(),sourceModified:sourceStat.mtime.toISOString()});
    await writeJSON(path.join(state,'map.json'),value);
    return `Map refreshed: ${value.chunks.length} explored chunks and ${value.entities.length} objects.${value.limited?' Limited to the 2,048 chunks nearest spawn.':''}`;
  }finally{
    if(exists){await docker('POST',`/containers/${helper}/stop?t=15`).catch(()=>{});await docker('DELETE',`/containers/${helper}`).catch(()=>{});}
    await fs.rm(work,{recursive:true,force:true}).catch(()=>{});
  }
}
