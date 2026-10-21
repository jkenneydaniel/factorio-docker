import {zipEntries} from '../../core/archive.js';
import {validateWorld} from './world-archive.js';
import {assert} from '../../common.js';

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
