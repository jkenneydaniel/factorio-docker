import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {assert,readJSON,writeJSON,json,requestJSON} from '../common.js';
import {digest,compareVersions} from './mod-downloads.js';
import {realDirectory,safeModFile,modRevision} from './mod-store.js';

export const modLibraryRoutes=['/mod-library','/mod-library-plan','/mod-library-account'];
export function validateLibraryAction(action,params){
  if(action==='mod-library-install')assert(params?.confirm===true&&/^[a-f0-9-]{36}$/.test(params.planId||''),'Review and confirm the mod change first.');
  if(action==='mod-library-recover')assert(params?.confirm===true,'Confirm restoring the interrupted mod change.');
}
export function createModLibrary({state,provider,adapter,assertStopped,canPlan=()=>true,now=Date.now}){
  const storage=path.join(state,'mod-library'),journalFile=path.join(storage,'transaction.json'),recordFile=path.join(storage,'installed.json');let planning=false;
  async function storageReady(){await realDirectory(storage,{create:true});}
  async function records(){await storageReady();return readJSON(recordFile,{});}
  async function assertReady(){const value=await readJSON(journalFile,null);assert(!value||['complete','recovered'].includes(value.phase),'An interrupted mod change needs recovery in Mods before other operations.',409);}
  async function inventory(){const context=await adapter.inventory();const known=await records();context.items=context.items.map(item=>{const record=known[context.scope+'/'+item.id]||Object.entries(known).find(([key,value])=>key.startsWith(context.scope+'/')&&value.name===item.name)?.[1];return {...item,id:record?.id||item.id,managed:!!record,modified:!!record&&record.sha256!==item.sha256,source:record?.source||null,version:item.version||(!record||record.sha256!==item.sha256?null:record.version)};});return context;}
  async function view(params){
    const context=await inventory(),tab=params.get('tab')||'browse',query=(params.get('query')||'').trim(),page=Number(params.get('page')||1);
    assert(['browse','installed','updates'].includes(tab)&&query.length<=100&&Number.isInteger(page)&&page>=1&&page<=10000,'Invalid library filter.');
    const transaction=await readJSON(journalFile,null),base={game:adapter.game,source:provider.source,scope:context.scope,version:context.version,tab,editable:await adapter.editable(),recoveryRequired:!!transaction&&!['complete','recovered'].includes(transaction.phase),account:await adapter.accountStatus?.(),note:adapter.note,...await adapter.policy?.()};
    if(tab==='installed')return {...base,items:context.items,page:1,pages:1};
    if(tab==='updates'){
      const items=[],errors=[];let stale=false,cursor=0;
      assert(context.items.length<=100,'Too many installed mods to check at once.',409);
      const pending=context.items.filter(item=>item.version&&!item.modified&&(item.source||adapter.game!=='rust')),deadline=now()+120000;
      async function check(){while(cursor<pending.length){const item=pending[cursor++];if(now()>deadline){errors.push(item.title||item.id);continue;}
        try{const latest=await (provider.latest?provider.latest(item.id,context,params.get('refresh')==='true'):provider.detail(item.id,params.get('refresh')==='true'));stale||=!!latest.stale;if(latest.version&&compareVersions(latest.version,item.version)>0)items.push({...latest,installedVersion:item.version,enabled:item.enabled,available:latest.available!==false});}catch{errors.push(item.title||item.id);}
      }}
      await Promise.all(Array.from({length:Math.min(4,pending.length)},check));items.sort((a,b)=>a.title.localeCompare(b.title));
      return {...base,items,page:1,pages:1,errors,stale,checkedAt:new Date(now()).toISOString()};
    }
    const result=await provider.browse({query,page,refresh:params.get('refresh')==='true',version:context.version});
    return {...base,...result,items:result.items.map(item=>({...item,installedVersion:context.items.find(value=>value.id===item.id)?.version}))};
  }
  async function plan(body){
    assert(!planning&&canPlan(),'Wait for the current operation.',409);planning=true;
    try{
      await storageReady();await assertReady();const mode=body.mode||'stopped';assert(['stopped','restart','hot'].includes(mode),'Choose how to apply this change.');await adapter.reviewMode(mode);
      const context=await inventory();assert(!context.blocked,context.blocked||'Mod changes are unavailable.',409);
      assert(typeof body.id==='string'&&body.id.length<=100,'Choose a mod.');
      const operation=body.operation||'install';assert(['install','enable','disable','remove'].includes(operation),'Choose a mod operation.');
      const releases=operation==='install'?await provider.resolve(body.id,context):[];
      const changes=await adapter.changes({context,releases,operation,id:body.id});
      assert(changes.length&&changes.length<=120,'No mod files need changing.',409);
      assert(mode!=='hot'||changes.every(change=>!context.files.has(change.name)||(context.files.get(change.name).mode&0o004)!==0),'Private plugin file permissions require a stopped-server installation. Choose automatic stop/start or stop Rust first.',409);
      const sizes=new Map([...context.files].map(([name,file])=>[name,file.data.length]));for(const change of changes){if(change.data===null)sizes.delete(change.name);else sizes.set(change.name,change.data.length);}assert(sizes.size<=1000&&[...sizes.values()].reduce((sum,size)=>sum+size,0)<=256*1024**2,'The reviewed mod set exceeds the 256 MiB library limit.',409);
      const oldPlans=(await fs.readdir(storage)).filter(name=>/^plan-[a-f0-9-]{36}$/.test(name));
      for(const name of oldPlans){const stat=await fs.lstat(path.join(storage,name));if(now()-stat.mtimeMs>3600000)await fs.rm(path.join(storage,name),{recursive:true});}
      assert((await fs.readdir(storage)).filter(name=>name.startsWith('plan-')).length<20,'Too many pending mod reviews. Try again in an hour.',429);
      const id=crypto.randomUUID(),directory=path.join(storage,'plan-'+id);await realDirectory(directory,{create:true});
      const files=[];for(const [index,change] of changes.entries()){
        safeModFile(change.name);assert(!files.some(file=>file.name===change.name),'Duplicate mod destination.',409);
        if(change.data!==null)await fs.writeFile(path.join(directory,String(index)),change.data,{flag:'wx',mode:0o600});
        files.push({name:change.name,sha256:change.data===null?null:digest(change.data),mode:context.files.get(change.name)?.mode??0o644,index});
      }
      const descriptions=releases.map(release=>({id:release.id,name:release.name,title:release.title,version:release.version,sha256:digest(release.data),dependencies:release.dependencies||[],note:release.note}));
      const record={id,mode,created:now(),scope:context.scope,revision:modRevision(context),operation,mod:body.id,files,releases:descriptions};await writeJSON(path.join(directory,'plan.json'),record);
      return {id,mode,operation,releases:descriptions,files:files.map(({name,sha256})=>({name,remove:sha256===null})),message:mode==='hot'?'Apply plugin files and request a reload while Rust stays online. Previous source files are kept for recovery. Check compilation in server logs.':mode==='restart'?'Save and stop the server if running, apply the reviewed files, then start it. Connected players will be disconnected. Previous mod files are kept for recovery.':'Apply the reviewed files to a stopped server. Previous files are kept for recovery. Start the server yourself afterward.'};
    }finally{planning=false;}
  }
  async function restore(transaction,{hot=false,preserveEdits=false}={}){
    const context=await adapter.inventory();assert(context.scope===transaction.scope,'The selected framework changed. Restore it before recovering mods.',409);
    const store=await adapter.store(context),directory=path.join(storage,'history',transaction.id);await realDirectory(directory);
    for(const file of transaction.files){await (hot?adapter.assertApplying('hot'):assertStopped());const data=file.before===null?null:await fs.readFile(path.join(directory,String(file.index)));assert(data===null||digest(data)===file.before,'Mod recovery copy failed verification.',409);const current=await store.read(file.name),hash=current?digest(current.data):null;if(hash===file.before)continue;if(hash!==file.after){assert(preserveEdits,'A mod file was edited outside this change. Stop the server and recover the mod change.',409);if(current)await fs.writeFile(path.join(directory,'external-'+crypto.randomUUID()+'-'+file.index),current.data,{flag:'wx',mode:0o600});}await store.write(file.name,data,file.mode);}
    await writeJSON(recordFile,transaction.records);if(hot)await adapter.afterRestore?.(transaction);transaction.phase='recovered';await writeJSON(journalFile,transaction);
  }
  async function recover(){await storageReady();await assertStopped();const transaction=await readJSON(journalFile,null);assert(transaction&&!['complete','recovered'].includes(transaction.phase),'No interrupted mod change needs recovery.',409);await restore(transaction,{preserveEdits:true});return 'Previous mod files restored. The server remains stopped.';}
  async function install(planId){
    assert(/^[a-f0-9-]{36}$/.test(planId||''),'Invalid mod review.');await storageReady();await assertReady();
    const directory=path.join(storage,'plan-'+planId);assert(await realDirectory(directory),'This review expired. Review the mod again.',409);
    const plan=await readJSON(path.join(directory,'plan.json'),null),context=await inventory();
    assert(plan&&now()-plan.created<900000&&plan.scope===context.scope&&plan.revision===modRevision(context),'The installation changed or this review expired. Review the mod again.',409);
    const changes=[];for(const file of plan.files){safeModFile(file.name);const data=file.sha256===null?null:await fs.readFile(path.join(directory,String(file.index)));assert(data===null||digest(data)===file.sha256,'Reviewed download failed verification.',409);changes.push({...file,data});}
    let stoppedForInstall=false,store,previous,transaction;
    try{
      stoppedForInstall=await adapter.prepare(plan.mode)===true;await adapter.assertApplying(plan.mode);
      store=await adapter.store(context);previous=await records();transaction={mode:plan.mode,id:crypto.randomUUID(),phase:'applying',scope:context.scope,records:previous,files:[]};
      const history=path.join(storage,'history',transaction.id);await realDirectory(history,{create:true});
      for(const [index,file] of changes.entries()){const before=context.files.get(file.name);if(before)await fs.writeFile(path.join(history,String(index)),before.data,{flag:'wx',mode:0o600});transaction.files.push({name:file.name,index,before:before?digest(before.data):null,after:file.sha256,mode:before?.mode??file.mode});}
      await adapter.assertApplying(plan.mode);assert(modRevision(await inventory())===plan.revision,'Mod files changed after review.',409);await writeJSON(journalFile,transaction);
    }catch(error){
      // No mod files have changed yet. Restore only a server we cleanly stopped,
      // and retain the startup gate if a transaction journal needs recovery.
      if(stoppedForInstall)try{await assertReady();await adapter.finish(plan.mode);}catch{throw Error('Mod preparation failed before applying the reviewed files, and the server could not be restarted. Check Mods and Logs before starting it again.',{cause:error});}
      throw error;
    }
    try{
      for(const file of changes){await adapter.assertApplying(plan.mode);const current=await store.read(file.name),expected=context.files.get(file.name);assert((current?digest(current.data):null)===(expected?digest(expected.data):null),'Mod files changed during installation.',409);await store.write(file.name,file.data,file.mode);}
      const next={...previous};for(const release of plan.releases)next[context.scope+'/'+release.id]={...release,source:provider.source};if(plan.operation==='remove')delete next[context.scope+'/'+plan.mod];
      await adapter.assertApplying(plan.mode);if(plan.mode==='hot')await adapter.afterApply(plan,context);await writeJSON(recordFile,next);transaction.phase='complete';await writeJSON(journalFile,transaction);
    }catch(error){try{await adapter.assertApplying(plan.mode);await restore(transaction,{hot:plan.mode==='hot'});}catch{throw Error('Mod change was interrupted. Keep the server stopped and use Recover mod change.');}throw error;}
    // A cleanup failure must never roll back an already committed transaction.
    await fs.rm(directory,{recursive:true}).catch(()=>{});
    try{await adapter.finish(plan.mode);}catch{throw Error('Mod files were installed, but the server did not become ready. Check Logs before starting it again.');}return 'Mod '+plan.operation+' complete. '+(plan.mode==='hot'?'Rust stayed online; check plugin compilation in Logs.':plan.mode==='restart'?'The server was started with the reviewed changes.':'The server remains stopped.');
  }
  async function handle(req,res,url){
    if(req.method==='GET'&&url.pathname==='/mod-library')return json(res,200,await view(url.searchParams));
    if(req.method==='POST'&&url.pathname==='/mod-library-plan')return json(res,200,await plan(await requestJSON(req)));
    if(req.method==='POST'&&url.pathname==='/mod-library-account'){assert(adapter.account,'This mod source does not need an account.');assert(canPlan()&&!planning,'Wait for the current operation.',409);return json(res,200,await adapter.account(await requestJSON(req)));}
    assert(false,'Not found.',404);
  }
  return {view,plan,install,recover,handle,assertReady,actions:{'mod-library-install':params=>install(params.planId),'mod-library-recover':()=>recover()}};
}
