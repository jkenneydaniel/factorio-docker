import {zipEntries,validateWorld} from './zip.js';
import {assert} from './common.js';

export function validateBackup(buffer){
  const entries=zipEntries(buffer);let worlds=0,total=0,manifest=null;
  for(const entry of entries){
    assert(entry.name==='panel-manifest.json'||/^(saves|config|mods)\//.test(entry.name),'Unexpected file in backup.');
    const content=entry.read();total+=content.length;
    if(entry.name==='panel-manifest.json')manifest=JSON.parse(content);
    if(entry.name==='config/server-settings.json')assert(typeof JSON.parse(content)==='object','Invalid server settings.');
    if(entry.name.startsWith('saves/')&&entry.name.endsWith('.zip')){for(const nested of validateWorld(content))nested.read();worlds++;}
  }
  assert(worlds>0,'Backup has no world saves.');
  assert(entries.some(item=>item.name==='config/server-settings.json'),'Backup has no server settings.');
  if(manifest?.activeSave)assert(entries.some(item=>item.name==='saves/'+manifest.activeSave),'Backup is missing its active world.');
  return {files:entries.length,worlds,uncompressedBytes:total};
}

export function summarizeBackups(items,schedule,jobs,storage){
  const latest=items[0]||null,verified=items.filter(item=>item.validation?.ok===true).sort((a,b)=>b.validation.checked.localeCompare(a.validation.checked))[0]||null;
  const lastJob=jobs.find(item=>item.action==='backup'&&!['running','queued'].includes(item.state));
  const alerts=[];
  if(!latest)alerts.push('No backups exist yet.');
  else if(Date.now()-new Date(latest.modified).getTime()>(schedule.enabled?schedule.hours*2:48)*3600000)alerts.push('The latest backup is older than expected.');
  if(lastJob?.state==='failed')alerts.push('The latest backup attempt failed: '+lastJob.message);
  if(items.some(item=>item.validation?.ok===false))alerts.push('A backup failed its integrity check.');
  if(storage&&storage.freeBytes<1024**3)alerts.push('Less than 1 GB of storage is available.');
  return {count:items.length,totalBytes:items.reduce((sum,item)=>sum+item.size,0),latestAt:latest?.modified||null,lastVerifiedAt:verified?.validation.checked||null,verifiedCount:items.filter(item=>item.validation?.ok).length,lastAttempt:lastJob?{state:lastJob.state,finished:lastJob.finished,message:lastJob.message}:null,nextScheduledAt:schedule.enabled&&schedule.lastRun?new Date(new Date(schedule.lastRun).getTime()+schedule.hours*3600000).toISOString():null,storage,alerts};
}
