import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {assert,readJSON,writeJSON} from './common.js';

const day=86400000, lifetime=10*60000;
export const defaultRetention={enabled:false,days:30,includeManual:false,includeSafety:false};
export function retentionPolicy(value){
  assert(value&&typeof value==='object'&&!Array.isArray(value),'Choose a backup retention policy.');
  assert(typeof value.enabled==='boolean'&&typeof value.includeManual==='boolean'&&typeof value.includeSafety==='boolean','Invalid backup cleanup options.');
  assert(Number.isInteger(value.days)&&value.days>=1&&value.days<=3650,'Keep backups for between 1 and 3650 days.');
  return Object.fromEntries(Object.keys(defaultRetention).map(key=>[key,value[key]]));
}
const kind=name=>/-scheduled\.(zip|tar\.gz)$/.test(name)?'scheduled':/-manual\.(zip|tar\.gz)$/.test(name)?'manual':/-before-[A-Za-z0-9_.-]+\.(zip|tar\.gz)$/.test(name)?'safety':'unknown';
const identity=stat=>[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs];
const fingerprint=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const publicFile=({relative,size,modified,kind})=>({relative,size,modified,kind});

export function retentionSelection(items,{policy,cutoff,keep=null,protectedNames=[],validations={}}){
  protectedNames=new Set(protectedNames);
  const verified=items.find(item=>validations[item.relative]?.ok&&validations[item.relative].size===item.size&&validations[item.relative].modified===item.modified)?.relative;
  const counts={},candidates=[],protectedFiles=[];
  for(const item of items){
    const ordinal=counts[item.kind]=(counts[item.kind]||0)+1;
    let reason=null;
    if(protectedNames.has(item.relative))reason='Required for update recovery';
    else if(item.kind==='unknown')reason='Unrecognized archive; keep for manual review';
    else if(ordinal<=2)reason='One of the newest two '+item.kind+' backups';
    else if(item.relative===verified)reason='Most recent verified backup';
    else if(keep!==null&&item.kind!=='scheduled')reason='Only scheduled backups use the count limit';
    else if(item.kind==='manual'&&!policy.includeManual)reason='Manual backups excluded';
    else if(keep===null&&item.kind==='safety'&&!policy.includeSafety)reason='Pre-change backups excluded';
    else if(keep!==null?ordinal<=keep:Date.parse(item.modified)>=Date.parse(cutoff))reason=keep!==null?'Within scheduled backup limit':'Within retention window';
    if(reason)protectedFiles.push({...publicFile(item),reason});else candidates.push(publicFile(item));
  }
  return {candidates,protected:protectedFiles,bytes:candidates.reduce((sum,item)=>sum+item.size,0)};
}

// Only this directory's regular archives in the configured format are eligible. World libraries,
// autosaves, directories and symbolic links never enter a deletion plan.
export class BackupRetention{
  constructor({root,file,extension='.zip',protectedNames=()=>[],validations=()=>({}),onDeleted=async()=>{},now=Date.now}){
    Object.assign(this,{root,file,extension,protectedNames,validations,onDeleted,now});this.plans=new Map();this.writes=Promise.resolve();
  }
  async init(){
    const saved=await readJSON(this.file,{});
    this.record={policy:retentionPolicy({...defaultRetention,...saved.policy}),revision:saved.revision||0,lastRun:saved.lastRun||null};
  }
  status(){return structuredClone(this.record);}
  get due(){return this.record.policy.enabled&&(!this.record.lastRun||this.now()-Date.parse(this.record.lastRun)>=day);}
  async inventory(){
    const items=[];
    for(const entry of await fs.readdir(this.root,{withFileTypes:true})){
      if(!entry.isFile()||!entry.name.endsWith(this.extension))continue;
      const stat=await fs.lstat(path.join(this.root,entry.name)).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
      if(stat?.isFile())items.push({relative:entry.name,size:stat.size,modified:stat.mtime.toISOString(),kind:kind(entry.name),identity:identity(stat)});
    }
    return items.sort((a,b)=>b.modified.localeCompare(a.modified)||a.relative.localeCompare(b.relative));
  }
  async selection(items,policy,cutoff,{keep=null}={}){
    return retentionSelection(items,{policy,cutoff,keep,protectedNames:await this.protectedNames(),validations:this.validations()});
  }
  async preview(value=this.record.policy){
    const policy=retentionPolicy(value),now=this.now(),items=await this.inventory(),cutoff=new Date(now-policy.days*day).toISOString();
    const selection=await this.selection(items,policy,cutoff);
    const plan={id:crypto.randomUUID(),policy,created:new Date(now).toISOString(),expires:new Date(now+lifetime).toISOString(),cutoff,...selection};
    for(const [id,entry] of this.plans)if(Date.parse(entry.plan.expires)<=now)this.plans.delete(id);
    if(this.plans.size>=50)this.plans.delete(this.plans.keys().next().value);
    this.plans.set(plan.id,{plan,inventory:fingerprint(items)});return structuredClone(plan);
  }
  async reviewed(id){
    const entry=this.plans.get(id);
    assert(entry&&Date.parse(entry.plan.expires)>this.now(),'Cleanup review expired. Review the backups again.',409);
    const items=await this.inventory(),selection=await this.selection(items,entry.plan.policy,entry.plan.cutoff);
    assert(fingerprint(items)===entry.inventory&&fingerprint(selection)===fingerprint({candidates:entry.plan.candidates,protected:entry.plan.protected,bytes:entry.plan.bytes}),'Backups or their protection changed. Review cleanup again.',409);
    return {entry,items};
  }
  queue(write){const result=this.writes.then(write);this.writes=result.catch(()=>{});return result;}
  configure(value,options){return this.queue(()=>this.savePolicy(value,options));}
  async savePolicy(value,{revision,planId,confirm}={}){
    const policy=retentionPolicy(value);
    assert(revision===this.record.revision,'Backup cleanup settings changed in another session. Reload before saving.',409);
    if(policy.enabled){
      assert(confirm===true,'Confirm automatic backup deletion first.');
      const {entry}=await this.reviewed(planId);
      assert(fingerprint(entry.plan.policy)===fingerprint(policy),'Review this policy before enabling automatic cleanup.',409);
    }
    const record={...this.record,policy,revision:this.record.revision+1};
    await writeJSON(this.file,record);this.record=record;this.plans.clear();return this.status();
  }
  async remove(items,candidates){
    const deleted=[];let bytes=0;
    try{
      for(const item of candidates){
        const expected=items.find(file=>file.relative===item.relative),target=path.join(this.root,item.relative),stat=await fs.lstat(target);
        assert(stat.isFile()&&fingerprint(identity(stat))===fingerprint(expected.identity),'A backup changed. Review cleanup again.',409);
        await fs.unlink(target);deleted.push(item.relative);bytes+=item.size;
      }
    }catch(error){error.message=`Cleanup stopped after deleting ${deleted.length} backup(s). ${error.message}`;throw error;}
    finally{if(deleted.length)await this.onDeleted(deleted);}
    return {deleted,bytes,message:`Deleted ${deleted.length} old backup${deleted.length===1?'':'s'}. Protected backups were kept.`};
  }
  async cleanup(id){const {entry,items}=await this.reviewed(id);this.plans.delete(id);return this.remove(items,entry.plan.candidates);}
  async pruneScheduled(keep){
    assert(Number.isInteger(keep)&&keep>=2&&keep<=100,'Invalid scheduled backup limit.');
    const items=await this.inventory(),selection=await this.selection(items,this.record.policy,null,{keep});
    return this.remove(items,selection.candidates);
  }
  ran(){return this.queue(async()=>{const record={...this.record,lastRun:new Date(this.now()).toISOString()};await writeJSON(this.file,record);this.record=record;});}
}
