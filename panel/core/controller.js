import fs from 'node:fs/promises';
import {ownedDocker} from '../fleet/owned-docker.js';
import {noManagedUpdater} from '../fleet/catalog.js';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {docker as dockerAPI} from './docker.js';
import {createHost} from './host.js';
import {createBackups} from './backups.js';
import {BackupRetention} from '../backup-retention.js';
import {assert,HttpError,sleep,readJSON,writeJSON,json,requestJSON,existingFile,equalSecret,redact} from '../common.js';
import {validateGameModule} from './game-module.js';

// One controller/operation lock per installation. The module supplies game
// behavior; the core owns persistence, authentication and operation coordination.
export async function startController(module,{env=process.env,docker=dockerAPI,port=Number(env.PORT||8081),hostname='0.0.0.0'}={}){
  validateGameModule(module);
  if(env.FLEET_ID)docker=ownedDocker(docker,env);
  const config=module.configuration(env),{state,library,backupDir}=config;
  await module.validateInstallation?.(config);
  const token=(await fs.readFile(env.CONTROLLER_TOKEN_FILE||'/run/secrets/controller_token','utf8')).trim();
  for(const dir of [state,library,backupDir])await fs.mkdir(dir,{recursive:true});
  let jobs=await readJSON(path.join(state,'jobs.json'),[]),active=null,retentionConfiguring=false;
  for(const job of jobs)if(['queued','running'].includes(job.state)){job.state='interrupted';job.message='Controller restarted during this operation. Check server status before retrying.';}
  await writeJSON(path.join(state,'jobs.json'),jobs);
  let schedule=await readJSON(path.join(state,'schedule.json'),{enabled:false,hours:6,keep:12,lastRun:null});
  const timers=[];
  const every=(fn,ms)=>{const timer=setInterval(fn,ms);timer.unref();timers.push(timer);return timer;};
  const host=createHost({docker,container:config.container,stopTimeout:module.stopTimeout});
  const ctx={config,env,host,docker,every,runJob,stageMessage,
    get jobs(){return jobs;},get active(){return active;},get schedule(){return schedule;},
    get updater(){return updater;},get backups(){return backups;}};
  const game=await module.createController(ctx);
  const backups=await createBackups({root:backupDir,state,game,getJobs:()=>jobs,getSchedule:()=>schedule});
  const updater=env.FLEET_ID?noManagedUpdater((await readJSON(new URL('../package.json',import.meta.url))).version):module.createUpdater({config,env,docker,backup:label=>backups.create(label),canInstall:()=>!active&&!retentionConfiguring,waitIdle:()=>game.waitIdle(),current:(await readJSON(new URL('../package.json',import.meta.url))).version});
  await game.init();
  await updater.init();
  const retention=new BackupRetention({root:backupDir,file:path.join(state,'backup-retention.json'),extension:game.backupExtension||'.zip',
    protectedNames:()=>updater.jobs.filter(job=>job.recovery?.requiresWorldRestore).map(job=>job.backup),
    validations:backups.validations,onDeleted:backups.deleted});
  await retention.init();
  const actions={...game.actions,
    backup:async(params,job)=>{const scheduled=job?.actor==='scheduled backup',name=await backups.create(scheduled?'scheduled':'manual');if(scheduled)await retention.pruneScheduled(schedule.keep);return `Backup created: ${name}`;},
    'verify-backup':params=>backups.verify(params.name),
    'cleanup-backups':async(params,job)=>{
      const automatic=job.actor==='automatic backup cleanup';
      if(automatic&&!retention.due)return 'Automatic backup cleanup is no longer due.';
      try{const planId=automatic?(await retention.preview()).id:params.planId;return await retention.cleanup(planId);}
      finally{if(automatic)await retention.ran();}
    },
  };
  async function setJob(job,updates){Object.assign(job,updates);await writeJSON(path.join(state,'jobs.json'),jobs);}
  async function stageMessage(job,message){await setJob(job,{message});}
  async function runJob(action,params,actor){
    assert(Object.hasOwn(actions,action),'Unsupported action.');
    await updater.refresh();assert(!updater.busy,'An update is in progress. Wait for it to finish.',409);
    assert(!updater.pendingRestore||action==='restore'&&params.name===updater.pendingRestore.backup,'Restore the recorded pre-update backup from Backups before running more server operations.',409);
    assert(!active&&!retentionConfiguring,'Another operation is in progress. Please wait.',409);
    const job={id:crypto.randomUUID(),action,actor,started:new Date().toISOString(),state:'running',message:'Starting…'};
    active=job;jobs.unshift(job);jobs=jobs.slice(0,100);await writeJSON(path.join(state,'jobs.json'),jobs);
    void (async()=>{
      try{await game.beforeJob(job);const result=await actions[action](params,job);if(action==='restore')await updater.restored(params.name);await setJob(job,{state:'succeeded',message:typeof result==='string'?result:result?.message||'Completed.',result,finished:new Date().toISOString()});}
      catch(error){await setJob(job,{state:'failed',message:redact(error.message),finished:new Date().toISOString()});}
      finally{
        try{await game.afterJob(job,params);}
        finally{active=null;game.invalidate();}
      }
    })();return job;
  }
  async function handle(req,res){
    if(req.url==='/health')return json(res,200,{ok:true});
    assert(equalSecret(req.headers.authorization,`Bearer ${token}`),'Unauthorized.',401);
    const url=new URL(req.url,'http://controller');
    if(url.pathname.startsWith('/update-')){
      if(req.method==='GET'&&url.pathname==='/update-status')return json(res,200,await updater.refresh());
      if(req.method==='POST'&&url.pathname==='/update-plan')return json(res,200,await updater.plan(await requestJSON(req)));
      if(req.method==='POST'&&url.pathname==='/update-install')return json(res,202,await updater.install(await requestJSON(req),req.headers['x-panel-user']||'administrator'));
      throw new HttpError(404,'Not found.');
    }
    if(req.method!=='GET'){await updater.refresh();assert(!updater.busy,'An update is in progress. Wait for it to finish.',409);}
    if(req.method==='GET'&&url.pathname==='/status')return json(res,200,await game.status());
    if(req.method==='GET'&&url.pathname==='/diagnostics')return json(res,200,await module.diagnostics({docker,container:config.container,version:updater.current,recentStatus:game.recentStatus(),locations:[...game.locations,{id:'backups',title:'Backup storage',path:backupDir},{id:'state',title:'Controller storage',path:state}]}));
    if(req.method==='GET'&&url.pathname==='/backups'){const items=await backups.list();return json(res,200,{backups:items,schedule,retention:retention.status(),health:await backups.health(items)});}
    if(req.method==='GET'&&url.pathname==='/jobs')return json(res,200,{jobs,active});
    if(req.method==='GET'&&url.pathname==='/download'&&url.searchParams.get('kind')==='backup'){
      const name=url.searchParams.get('name'),file=await existingFile(backupDir,name),stat=await fs.stat(file);
      assert(name.endsWith(game.backupExtension||'.zip'),'Unsupported backup format.');
      res.writeHead(200,{'content-type':game.backupExtension==='.tar.gz'?'application/gzip':'application/zip','content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name)}`,'content-length':stat.size});return pipeline(createReadStream(file),res);
    }
    if(req.method==='POST'&&url.pathname==='/jobs'){
      const body=await requestJSON(req);assert(Object.hasOwn(actions,body.action),'Unsupported action.');
      if(body.action==='cleanup-backups')assert(body.params?.confirm===true&&typeof body.params.planId==='string','Review and confirm backup cleanup first.');
      game.validateAction(body);
      return json(res,202,await runJob(body.action,body.params||{},body.actor||'admin'));
    }
    if(req.method==='POST'&&url.pathname==='/backup-retention'){
      const body=await requestJSON(req);
      if(body.operation==='preview')return json(res,200,await retention.preview(body.policy));
      assert(body.operation==='save','Choose a cleanup operation.');assert(!active&&!retentionConfiguring,'Wait for the current operation before changing cleanup settings.',409);
      retentionConfiguring=true;
      try{return json(res,200,await retention.configure(body.policy,body));}finally{retentionConfiguring=false;}
    }
    if(req.method==='POST'&&url.pathname==='/schedule'){
      const value=await requestJSON(req);assert(typeof value.enabled==='boolean'&&Number.isInteger(value.hours)&&value.hours>=1&&value.hours<=168&&Number.isInteger(value.keep)&&value.keep>=2&&value.keep<=100,'Invalid backup schedule.');
      game.validateSchedule?.(value);
      schedule={...schedule,enabled:value.enabled,hours:value.hours,keep:value.keep};await writeJSON(path.join(state,'schedule.json'),schedule);return json(res,200,{schedule});
    }
    // A module cannot expose undeclared controller endpoints.
    assert(module.routes.includes(url.pathname),'Not found.',404);
    return game.handle(req,res,url);
  }
  const server=http.createServer((req,res)=>handle(req,res).catch(error=>{if(!res.headersSent)json(res,error.status||500,{error:redact(error.message)});else res.end();}));
  server.requestTimeout=300000;
  // Timers are created only after successful initialization, and closed with the
  // listener so disposable hosts/tests cannot leak a scheduler.
  server.once('close',()=>{for(const timer of timers)clearInterval(timer);});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,hostname,resolve);});
  console.log(`Internal ${module.name} controller ready.`);
  every(()=>void updater.refresh().catch(error=>console.error('Update state unavailable:',redact(error.message))),1000);
  await game.start();
  every(async()=>{
    if(!schedule.enabled||active||updater.busy)return;
    const elapsed=Date.now()-new Date(schedule.lastRun||Date.now()).getTime();
    if(!schedule.lastRun){schedule.lastRun=new Date().toISOString();await writeJSON(path.join(state,'schedule.json'),schedule);return;}
    if(elapsed<schedule.hours*3600000)return;
    try{const job=await runJob('backup',{},'scheduled backup');while(['queued','running'].includes(job.state))await sleep(1000);schedule.lastRun=new Date().toISOString();await writeJSON(path.join(state,'schedule.json'),schedule);}
    catch(error){console.error('Scheduled backup failed:',redact(error.message));}
  },60000);
  let retentionPolling=false;
  every(async()=>{
    if(retentionPolling||!retention.due||active||updater.busy||updater.pendingRestore)return;
    retentionPolling=true;
    try{const job=await runJob('cleanup-backups',{},'automatic backup cleanup');while(['queued','running'].includes(job.state))await sleep(1000);}
    catch(error){console.error('Automatic backup cleanup failed:',redact(error.message));}
    finally{retentionPolling=false;}
  },60000);
  return server;
}
