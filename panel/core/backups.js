import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createReadStream} from 'node:fs';
import {assert,stamp,safeName,existingFile,writeJSON,readJSON,redact} from '../common.js';
import {makeZip} from './archive.js';
import {summarizeBackups} from './backup-health.js';
import {listFiles} from './files.js';

export async function createBackups({root:backupDir,state,game,getJobs,getSchedule}){
  const extension=game.backupExtension||'.zip';
  const validations=await readJSON(path.join(state,'backup-validation.json'),{});
  async function backupList(){return (await listFiles(backupDir,0)).filter(file=>file.relative.endsWith(extension)).map(file=>({...file,validation:validations[file.relative]?.size===file.size&&validations[file.relative]?.modified===file.modified?validations[file.relative]:null})).sort((a,b)=>b.modified.localeCompare(a.modified));}
  async function verifyBackup(name){
    const file=await existingFile(backupDir,name),stat=await fs.stat(file);let result;
    try{
      const details=game.verifyBackupFile?await game.verifyBackupFile(file):await game.validateBackup(await fs.readFile(file));
      const hash=crypto.createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);
      result={ok:true,...details,sha256:hash.digest('hex')};
    }
    catch(error){result={ok:false,error:redact(error.message)};}
    validations[name]={...result,size:stat.size,modified:stat.mtime.toISOString(),checked:new Date().toISOString()};
    await writeJSON(path.join(state,'backup-validation.json'),validations);
    assert(result.ok,result.error);return game.backupVerified(result);
  }
  async function backupHealth(items){let storage=null;try{const disk=await fs.statfs(backupDir);storage={freeBytes:disk.bavail*disk.bsize,totalBytes:disk.blocks*disk.bsize};}catch{}return summarizeBackups(items,getSchedule(),getJobs(),storage);}
  async function backup(label='manual',{save=true}={}){
    const files=game.writeBackup?null:await game.backupFiles(label,{save});
    const name=`${stamp()}-${safeName(label)}${extension}`;
    const target=path.join(backupDir,name),temporary=target+'.tmp';
    try{if(game.writeBackup)await game.writeBackup(temporary,label,{save});else await fs.writeFile(temporary,makeZip(files),{flag:'wx'});await fs.rename(temporary,target);}finally{await fs.unlink(temporary).catch(()=>{});}
    await verifyBackup(name);
    return name;
  }
  return {list:backupList,verify:verifyBackup,health:backupHealth,create:backup,validations:()=>validations,async deleted(names){for(const name of names)delete validations[name];await writeJSON(path.join(state,'backup-validation.json'),validations);}};
}
