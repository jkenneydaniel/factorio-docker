import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {startController} from '../core/controller.js';
import {startWeb} from '../core/web.js';
import {Accounts} from '../core/accounts.js';
import {hashPassword} from '../auth.js';
import {json,assert as check,readJSON,writeJSON} from '../common.js';
import {zipEntries} from '../core/archive.js';
import {selectedApplication} from '../applications/index.js';
import {waitForIdleJob,fixtureContract} from './fixtures.js';
import {noManagedUpdater} from '../core/managed-updater.js';
import {planStorageMigration,applyStorageMigration} from '../core/storage/migrations.js';
import {closeStorage,selectedStorage} from '../core/storage/selection.js';
import {AuditLog} from '../core/audit.js';

// A deliberately different game: no Factorio paths, ZIP saves, commands,
// world metadata, preview workers or Factorio account extensions.
async function fixture(t,{jobs=[],sqlite=false}={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'factory-core-'));
  t.after(async()=>{if(sqlite){await closeStorage(path.join(root,'state'));await closeStorage(path.join(root,'auth'));}await fs.rm(root,{recursive:true,force:true});});
  const state=path.join(root,'state'),backupDir=path.join(root,'archives'),auth=path.join(root,'auth');
  await fs.mkdir(state);await fs.mkdir(auth);await fs.writeFile(path.join(root,'token'),'test-token');
  await writeJSON(path.join(state,'jobs.json'),jobs);
  await fs.writeFile(path.join(root,'index.html'),'<title>Test game</title>');
  await writeJSON(path.join(auth,'users.json'),{admin:{...hashPassword('test-admin-password'),role:'admin'},viewer:{...hashPassword('test-viewer-password'),role:'viewer'}});
  if(sqlite)for(const [directory,profile] of [[state,'controller'],[auth,'accounts']])await applyStorageMigration(await planStorageMigration(directory,profile),{confirm:true,offline:true});
  let score=0,invalidations=0,release;
  const held=new Promise(resolve=>{release=resolve;});
  const updater={...noManagedUpdater('fixture'),async refresh(){return {busy:this.busy,jobs:[]};}};
  const module={
    id:'test-game',name:'Test Game',releaseRepository:'example/test-game',routes:['/score'],contract:fixtureContract(['increment','hold','fail'],{'/score':{GET:'viewer'}}),
    configuration:()=>({state,library:path.join(root,'library'),backupDir,container:'test-game'}),
    createUpdater:()=>updater,diagnostics:async()=>({checks:[]}),
    web:{Accounts,sessionCookie:'test_game_session',accountRoutes:[],adminReadRoutes:[],publicRoot:pathToFileURL(root+path.sep),assets:{'/':['index.html','text/html']},diagnosticsReport:()=>({checks:[]}),validateOnboarding(){}},
    async createController(ctx){return {
      actions:{increment:async()=>{score++;return 'Score increased.';},hold:async()=>{await held;return 'Released.';},fail:async()=>{throw Error('Deliberate test failure.');}},
      status:async()=>({ready:true,score,activeJob:ctx.active}),
      handle:async(req,res)=>{check(req.method==='GET','Not found.',404);return json(res,200,{score});},
      validateAction(){},backupFiles:async()=>[{name:'score.json',data:Buffer.from(JSON.stringify({score}))}],
      validateBackup(buffer){const entries=zipEntries(buffer);check(entries.length===1&&entries[0].name==='score.json','Invalid test-game backup.');check(Number.isInteger(JSON.parse(entries[0].read()).score),'Invalid score.');return {files:1};},
      backupVerified:result=>`Test-game archive verified: ${result.files} file.`,
      async init(){},async start(){},async beforeJob(){},async afterJob(){},async waitIdle(){},
      invalidate(){invalidations++;},recentStatus:()=>null,locations:[],
    };},
  };
  const env={CONTROLLER_TOKEN_FILE:path.join(root,'token'),AUTH_DIR:auth,RELEASE_CHECKS:'false',PANEL_HOSTS:'127.0.0.1'};
  const controller=await startController(module,{env,port:0,hostname:'127.0.0.1',docker:()=>assert.fail('The test game does not use Docker.')});
  t.after(()=>new Promise(resolve=>{controller.closeAllConnections();controller.close(resolve);}));
  const origin=`http://127.0.0.1:${controller.address().port}`;
  const request=(route,body)=>fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer test-token','content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const submit=async action=>{const response=await request('/jobs',{action});assert.equal(response.status,202,await response.clone().text());return response.json();};
  const settled=job=>waitForIdleJob(async()=>{const response=await request('/jobs');return response.json();},job.id);
  return {root,state,backupDir,module,env,origin,request,submit,settled,release,updater,invalidations:()=>invalidations};
}

test('a migrated controller records real operations, audit outcomes and settings in the selected database while preserving original JSON',async t=>{
 const f=await fixture(t,{sqlite:true}),legacy=await fs.readFile(path.join(f.state,'jobs.json'),'utf8');
 const completed=await f.settled(await f.submit('increment'));assert.equal(completed.state,'succeeded');
 const response=await f.request('/schedule',{enabled:true,hours:8,keep:5});assert.equal(response.status,200,await response.clone().text());
 const store=await selectedStorage(f.state);assert.equal(store.read('operations','jobs').value.find(job=>job.id===completed.id).state,'succeeded');
 assert.equal(store.read('configuration','schedule').value.hours,8);
 assert.equal(await fs.readFile(path.join(f.state,'jobs.json'),'utf8'),legacy);
 await assert.rejects(fs.access(path.join(f.state,'schedule.json')),{code:'ENOENT'});
 const events=(await new AuditLog(f.state).list()).events;assert.ok(events.some(event=>event.operationId===completed.id&&event.outcome==='succeeded'));
});

test('shared controller runs a different game, coordinates jobs, and delegates backup formats',{timeout:10000},async t=>{
  const f=await fixture(t);
  assert.equal((await fetch(f.origin+'/status')).status,401);
  assert.equal((await f.request('/world-options')).status,404,'Factorio routes must not leak into another module');
  assert.equal((await f.request('/jobs',{action:'save'})).status,400,'Only registered game actions are accepted');
  const held=await f.submit('hold');
  assert.equal((await f.request('/jobs',{action:'increment'})).status,409,'The shared operation lock covers module actions');
  f.release();assert.equal((await f.settled(held)).state,'succeeded');
  assert.equal((await f.settled(await f.submit('fail'))).state,'failed');
  assert.equal((await f.settled(await f.submit('increment'))).state,'succeeded','Failed actions release the lock');
  assert.equal((await (await f.request('/score')).json()).score,1);
  const backup=await f.settled(await f.submit('backup'));assert.equal(backup.state,'succeeded');
  const items=(await (await f.request('/backups')).json()).backups;assert.equal(items.length,1);assert.equal(items[0].validation.ok,true);
  const download=await f.request('/download?kind=backup&name='+encodeURIComponent(items[0].relative));assert.equal(download.status,200);
  assert.equal(JSON.parse(zipEntries(Buffer.from(await download.arrayBuffer()))[0].read()).score,1);
  assert.equal((await f.request('/jobs',{action:'verify-backup',params:{name:items[0].relative}})).status,202);
  const jobs=await (await f.request('/jobs')).json();await f.settled(jobs.jobs[0]);
  assert.ok(f.invalidations()>=5);
  assert.equal((await readJSON(path.join(f.state,'jobs.json'))).find(job=>job.action==='increment').state,'succeeded');
  f.updater.busy=true;assert.equal((await f.request('/jobs',{action:'increment'})).status,409);
});

test('a failed initial job write releases the controller lock and preserves history',async t=>{
  const f=await fixture(t);
  await f.settled(await f.submit('increment'));
  const before=await (await f.request('/jobs')).json(),writeFile=fs.writeFile;
  let fail=true;
  t.mock.method(fs,'writeFile',async(file,...args)=>{
    if(fail&&String(file).startsWith(path.join(f.state,'jobs.json.'))){fail=false;throw Object.assign(Error('Simulated full disk'),{code:'ENOSPC'});}
    return writeFile(file,...args);
  });
  assert.equal((await f.request('/jobs',{action:'increment'})).status,500);
  const rejected=await (await f.request('/jobs')).json();
  assert.equal(rejected.active,null);assert.deepEqual(rejected.jobs,before.jobs);
  assert.equal((await f.settled(await f.submit('increment'))).state,'succeeded');
  assert.equal((await (await f.request('/score')).json()).score,2);
});

test('controller request IDs prevent duplicate effects and reject changed requests',async t=>{
  const f=await fixture(t),body={action:'increment',requestId:'duplicate-browser-request'};
  const first=await (await f.request('/jobs',body)).json();
  const second=await (await f.request('/jobs',body)).json();assert.equal(first.id,second.id);
  await f.settled(first);assert.equal((await (await f.request('/score')).json()).score,1);
  assert.equal((await (await f.request('/jobs',body)).json()).id,first.id);
  assert.equal((await f.request('/jobs',{...body,params:{different:true}})).status,409);
});

test('controller exposes capabilities and additive common status without changing legacy game fields',async t=>{
  const f=await fixture(t),contract=await(await f.request('/capabilities')).json(),status=await(await f.request('/status')).json();
  assert.equal(contract.version,1);assert.equal(contract.id,'test-game');assert.equal(contract.actions.increment.confirmation,false);
  assert.equal(status.score,0);assert.equal(status.ready,true);assert.equal(status.statusVersion,1);assert.equal(status.summary.state,'ready');
  assert.equal((await f.request('/jobs',{action:'increment',params:[]})).status,400);
  assert.equal((await f.request('/score',{})).status,404,'A declared GET endpoint cannot be called with POST');
});

test('controller restart requires outcome review and acknowledgement without replaying an interrupted action',async t=>{
  const f=await fixture(t,{jobs:[{id:'interrupted',action:'increment',state:'running',phase:'executing'}]});
  assert.equal((await (await f.request('/score')).json()).score,0);
  assert.equal((await f.request('/jobs',{action:'increment'})).status,409);
  assert.equal((await f.request('/jobs/recovery',{id:'interrupted',operation:'acknowledge',confirm:true})).status,400);
  const checked=await (await f.request('/jobs/recovery',{id:'interrupted',operation:'inspect'})).json();
  assert.equal(checked.recovery.required,true);assert.match(checked.recovery.message,/No operation was replayed/);
  assert.equal((await f.request('/jobs/recovery',{id:'interrupted',operation:'retry',confirm:true})).status,409);
  const reviewed=await (await f.request('/jobs/recovery',{id:'interrupted',operation:'acknowledge',confirm:true})).json();
  assert.equal(reviewed.state,'interrupted');assert.equal(reviewed.recovery.required,false);
  await f.settled(await f.submit('increment'));assert.equal((await (await f.request('/score')).json()).score,1);
});

test('a controller completion-write failure keeps recovery visible and blocks subsequent side effects',async t=>{
  const f=await fixture(t),writeFile=fs.writeFile;let fail=true;
  t.mock.method(fs,'writeFile',async(file,data,...args)=>{
    if(fail&&String(file).startsWith(path.join(f.state,'jobs.json.'))&&JSON.parse(data)[0]?.phase==='settled'){fail=false;throw Error('Simulated completion-write failure');}
    return writeFile(file,data,...args);
  });
  const result=await f.settled(await f.submit('increment'));assert.equal(result.state,'interrupted');
  assert.equal((await (await f.request('/score')).json()).score,1);
  assert.equal((await f.request('/jobs',{action:'increment'})).status,409);
  const stored=await readJSON(path.join(f.state,'jobs.json'));assert.equal(stored[0].recovery.required,true);
});

test('shared web service uses module assets and cookies and keeps permissions and route allowlists',{timeout:10000},async t=>{
  const f=await fixture(t);
  const web=await startWeb(f.module,{env:{...f.env,CONTROLLER_URL:f.origin},port:0,hostname:'127.0.0.1'});
  t.after(()=>new Promise(resolve=>{web.closeAllConnections();web.close(resolve);}));
  const origin=`http://127.0.0.1:${web.address().port}`;
  assert.equal(await (await fetch(origin)).text(),'<title>Test game</title>');
  for(const asset of ['/shell.js','/shell.css','/client.js'])assert.equal((await fetch(origin+asset)).status,200,'Shared assets do not depend on a game public directory');
  assert.equal((await fetch(origin+'/map.js')).status,404);
  assert.equal((await fetch(origin+'/api/score')).status,401);
  async function login(username){
    const response=await fetch(origin+'/api/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username,password:'test-'+username+'-password'})});
    assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/^test_game_session=/);
    return {cookie:response.headers.get('set-cookie').split(';')[0],...(await response.json())};
  }
  const admin=await login('admin'),viewer=await login('viewer');
  assert.equal((await fetch(origin+'/api/operations',{headers:{cookie:viewer.cookie}})).status,403);
  assert.equal((await fetch(origin+'/api/jobs?workflows=1',{headers:{cookie:viewer.cookie}})).status,403);
  const progress=await(await fetch(origin+'/api/jobs?workflows=1',{headers:{cookie:admin.cookie}})).json();assert.equal(progress.workflow.version,1);assert.ok(progress.workflow.operations.every(job=>job.source!=='jobs'));
  assert.equal(Object.hasOwn(await(await fetch(origin+'/api/jobs',{headers:{cookie:viewer.cookie}})).json(),'workflow'),false);
  const operationFeed=await fetch(origin+'/api/operations',{headers:{cookie:admin.cookie}});assert.equal(operationFeed.status,200);assert.equal((await operationFeed.json()).version,1);
  assert.equal((await fetch(origin+'/api/operations/recovery',{method:'POST',headers:{origin,cookie:admin.cookie,'content-type':'application/json'},body:JSON.stringify({source:'jobs',id:'unknown',operation:'inspect'})})).status,403,'Operation recovery requires CSRF verification');
  assert.equal((await fetch(origin+'/api/score',{headers:{cookie:viewer.cookie}})).status,200);
  assert.equal((await fetch(origin+'/api/world-options',{headers:{cookie:admin.cookie}})).status,404);
  const mutate=(user,csrf)=>fetch(origin+'/api/jobs',{method:'POST',headers:{origin,cookie:user.cookie,'content-type':'application/json',...(csrf?{'x-csrf-token':user.csrf}:{})},body:JSON.stringify({action:'increment'})});
  assert.equal((await mutate(viewer,true)).status,403);assert.equal((await mutate(admin,false)).status,403);
  const response=await mutate(admin,true);assert.equal(response.status,202);await f.settled(await response.json());
});

test('default module preserves legacy installation settings and rejects unknown module names',()=>{
  const module=selectedApplication();assert.equal(module.id,'factorio');assert.equal(module.web.sessionCookie,'factorio_session');
  assert.deepEqual(module.configuration({}),{data:'/factorio',backups:'/backups',state:'/state',container:'factorio-server',library:'/backups/panel-worlds',backupDir:'/backups/panel-backups'});
  const config=module.configuration({FACTORIO_DATA:'/custom/data',FACTORIO_CONTAINER:'custom-game',BACKUPS_DIR:'/custom/backups',STATE_DIR:'/custom/state'});
  assert.equal(config.data,'/custom/data');assert.equal(config.container,'custom-game');assert.equal(config.library,'/custom/backups/panel-worlds');
  assert.throws(()=>selectedApplication('../../outside'),/Unsupported application/);
});

test('Factorio adapter uses the supplied host transport and legacy commands with custom data/container settings',{timeout:10000},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'factory-factorio-module-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  // Any accidental fallback to the global transport must fail against a missing
  // socket, rather than ever reaching the host's Docker engine.
  const previousSocket=process.env.DOCKER_SOCKET;process.env.DOCKER_SOCKET=path.join(root,'no-engine.sock');
  t.after(()=>{if(previousSocket===undefined)delete process.env.DOCKER_SOCKET;else process.env.DOCKER_SOCKET=previousSocket;});
  const module=selectedApplication(),config=module.configuration({FACTORIO_DATA:path.join(root,'data'),FACTORIO_CONTAINER:'custom-factorio',STATE_DIR:path.join(root,'state'),BACKUPS_DIR:path.join(root,'backups')});
  for(const dir of [config.state,path.join(config.data,'saves'),path.join(config.data,'config')])await fs.mkdir(dir,{recursive:true});
  const log=path.join(config.data,'factorio-current.log');
  await fs.writeFile(log,'0.000 Loading map /factorio/saves/Legacy.zip: 100 bytes.\n');
  await fs.writeFile(path.join(config.data,'saves/Legacy.zip'),'fixture');
  await writeJSON(path.join(config.data,'config/server-settings.json'),{name:'Legacy factory',auto_pause:true,autosave_interval:5,autosave_slots:10});
  const commands=[],calls=[];let command;
  const docker=async(method,route,body)=>{
    calls.push([method,route]);
    if(route.startsWith('/containers/json?'))return [];
    if(route==='/containers/custom-factorio/exec'){command=body.Cmd[1];commands.push(command);return {Id:'test-exec'};}
    if(route==='/exec/test-exec/json')return {ExitCode:0};
    if(route==='/exec/test-exec/start'){
      let output={'/version':'Version: 2.0.77','/seed':'12345','/players online':'Online players (0):','/time':'1 hour','/server-save':'Saving the map'}[command];
      assert.notEqual(output,undefined,'Unexpected Factorio command');
      if(command==='/server-save')await fs.appendFile(log,'10.000 Info AppManagerStates.cpp:1: Saving finished\n');
      const value=Buffer.from(output),header=Buffer.alloc(8);header[0]=1;header.writeUInt32BE(value.length,4);return Buffer.concat([header,value]);
    }
    assert.fail('Unexpected module host request: '+method+' '+route);
  };
  const game=await module.createController({config,env:{GAME_ADDRESS:'example.invalid:34197'},docker,jobs:[],active:null,schedule:{enabled:false},updater:{busy:false},
    host:{info:async()=>({State:{Running:true,Status:'running',StartedAt:new Date().toISOString()},Config:{Image:'factoriotools/factorio:2.0.77'}}),metrics:async()=>({cpu:1,memory:1024})}});
  await game.init();
  const status=await game.status();assert.equal(status.currentWorld,'Legacy.zip');assert.equal(status.connection,'example.invalid:34197');assert.equal(status.name,'Legacy factory');assert.equal(status.version,'Version: 2.0.77');assert.equal(status.paused,true);
  assert.equal(await game.actions.save(),'World saved successfully.');
  assert.deepEqual(commands,['/players online','/time','/seed','/version','/server-save']);
  assert.ok(calls[0][1].startsWith('/containers/json?'),'Preview recovery uses the supplied transport');
});

test('trusted game-only update context rejects panel reviews and is retained through installation',async t=>{
 const f=await fixture(t),calls=[];
 f.updater.refresh=async()=>({busy:false,jobs:[{id:'panel-job',kind:'panel'},{id:'game-job',kind:'game',recovery:{action:'Review backup',directory:'/private/recovery'}}]});
 f.updater.plan=async input=>{calls.push(input);return input;};
 f.updater.install=async(input,actor,policy)=>{calls.push({input,actor,policy});return {id:'accepted'};};
 const request=(route,body)=>fetch(f.origin+route,{method:body?'POST':'GET',headers:{authorization:'Bearer test-token','content-type':'application/json','x-panel-user':'Assigned','x-panel-update-kind':'game'},body:body?JSON.stringify(body):undefined});
 assert.equal((await request('/update-plan',{kind:'panel'})).status,403);assert.equal(calls.length,0);
 assert.equal((await request('/update-plan',{kind:'game'})).status,200);
 assert.equal((await request('/update-install',{planId:'fixture',confirm:true})).status,202);
 assert.equal(calls.at(-1).actor,'Assigned');assert.deepEqual(calls.at(-1).policy,{gameOnly:true});
 const status=await(await request('/update-status')).json();assert.deepEqual(status.jobs,[{id:'game-job',kind:'game',recovery:{action:'Review backup'}}]);
});
