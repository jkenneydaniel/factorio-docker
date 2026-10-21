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
import {zipEntries} from '../zip.js';
import {selectedGame} from '../games/index.js';
import {waitForIdleJob} from './fixtures.js';

// A deliberately different game: no Factorio paths, ZIP saves, commands,
// world metadata, preview workers or Factorio account extensions.
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'factory-core-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const state=path.join(root,'state'),backupDir=path.join(root,'archives'),auth=path.join(root,'auth');
  await fs.mkdir(state);await fs.mkdir(auth);await fs.writeFile(path.join(root,'token'),'test-token');
  await fs.writeFile(path.join(root,'index.html'),'<title>Test game</title>');
  await writeJSON(path.join(auth,'users.json'),{admin:{...hashPassword('test-admin-password'),role:'admin'},viewer:{...hashPassword('test-viewer-password'),role:'viewer'}});
  let score=0,invalidations=0,release;
  const held=new Promise(resolve=>{release=resolve;});
  const updater={current:'fixture',jobs:[],busy:false,pendingRestore:null,async init(){},async refresh(){return {busy:this.busy,jobs:[]};},async restored(){}};
  const module={
    id:'test-game',name:'Test Game',releaseRepository:'example/test-game',routes:['/score'],
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

test('shared web service uses module assets and cookies and keeps permissions and route allowlists',{timeout:10000},async t=>{
  const f=await fixture(t);
  const web=await startWeb(f.module,{env:{...f.env,CONTROLLER_URL:f.origin},port:0,hostname:'127.0.0.1'});
  t.after(()=>new Promise(resolve=>{web.closeAllConnections();web.close(resolve);}));
  const origin=`http://127.0.0.1:${web.address().port}`;
  assert.equal(await (await fetch(origin)).text(),'<title>Test game</title>');
  assert.equal((await fetch(origin+'/map.js')).status,404);
  assert.equal((await fetch(origin+'/api/score')).status,401);
  async function login(username){
    const response=await fetch(origin+'/api/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username,password:'test-'+username+'-password'})});
    assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/^test_game_session=/);
    return {cookie:response.headers.get('set-cookie').split(';')[0],...(await response.json())};
  }
  const admin=await login('admin'),viewer=await login('viewer');
  assert.equal((await fetch(origin+'/api/score',{headers:{cookie:viewer.cookie}})).status,200);
  assert.equal((await fetch(origin+'/api/world-options',{headers:{cookie:admin.cookie}})).status,404);
  const mutate=(user,csrf)=>fetch(origin+'/api/jobs',{method:'POST',headers:{origin,cookie:user.cookie,'content-type':'application/json',...(csrf?{'x-csrf-token':user.csrf}:{})},body:JSON.stringify({action:'increment'})});
  assert.equal((await mutate(viewer,true)).status,403);assert.equal((await mutate(admin,false)).status,403);
  const response=await mutate(admin,true);assert.equal(response.status,202);await f.settled(await response.json());
});

test('default module preserves legacy installation settings and rejects unknown module names',()=>{
  const module=selectedGame();assert.equal(module.id,'factorio');assert.equal(module.web.sessionCookie,'factorio_session');
  assert.deepEqual(module.configuration({}),{data:'/factorio',backups:'/backups',state:'/state',container:'factorio-server',library:'/backups/panel-worlds',backupDir:'/backups/panel-backups'});
  const config=module.configuration({FACTORIO_DATA:'/custom/data',FACTORIO_CONTAINER:'custom-game',BACKUPS_DIR:'/custom/backups',STATE_DIR:'/custom/state'});
  assert.equal(config.data,'/custom/data');assert.equal(config.container,'custom-game');assert.equal(config.library,'/custom/backups/panel-worlds');
  assert.throws(()=>selectedGame('../../outside'),/Unsupported game module/);
});

test('Factorio adapter uses the supplied host transport and legacy commands with custom data/container settings',{timeout:10000},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'factory-factorio-module-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  // Any accidental fallback to the global transport must fail against a missing
  // socket, rather than ever reaching the host's Docker engine.
  const previousSocket=process.env.DOCKER_SOCKET;process.env.DOCKER_SOCKET=path.join(root,'no-engine.sock');
  t.after(()=>{if(previousSocket===undefined)delete process.env.DOCKER_SOCKET;else process.env.DOCKER_SOCKET=previousSocket;});
  const module=selectedGame(),config=module.configuration({FACTORIO_DATA:path.join(root,'data'),FACTORIO_CONTAINER:'custom-factorio',STATE_DIR:path.join(root,'state'),BACKUPS_DIR:path.join(root,'backups')});
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
