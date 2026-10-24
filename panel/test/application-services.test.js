import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import definition from './fixtures/service-app-definition.json' with {type:'json'};
import {ApplicationServices,definitionFingerprint,serviceOrder} from '../core/application-services.js';
import {serviceApp} from './fixtures/service-app.js';
import {startController} from '../core/controller.js';
import {startWeb} from '../core/web.js';
import {hashPassword} from '../auth.js';
import {writeJSON} from '../common.js';
import {waitForIdleJob} from './fixtures.js';

function drivers(states,events=[]){return Object.fromEntries(definition.services.map(service=>[service.id,{
  inspect:async()=>states[service.id],start:async values=>{events.push(['start',service.id,values]);states[service.id]={running:true,ready:true};},stop:async()=>{events.push(['stop',service.id]);states[service.id]={running:false,ready:false};},logs:async()=>service.id,
}]))}
test('service graphs reject unknown roles, duplicate services, missing dependencies, cycles and optional primaries',()=>{
  assert.deepEqual(serviceOrder(definition).map(service=>service.id),['web','queue','scheduler']);
  for(const change of [d=>{d.version=2;},d=>{d.services.push(d.services[0]);},d=>{d.services[0].dependsOn=['absent'];},d=>{d.services[0].dependsOn=['queue'];},d=>{d.services[0].required=false;},d=>{d.services[0].dockerSocket=true;},d=>{d.services[0].role='host-admin';}]){
    const next=structuredClone(definition);change(next);assert.throws(()=>serviceOrder(next));
  }
});
test('definition identity pins contents independently of JSON property order and package revision',()=>{
  const reordered=Object.fromEntries(Object.entries(definition).reverse());assert.equal(definitionFingerprint(reordered),definitionFingerprint(definition));
  const edited=structuredClone(definition);edited.name='A different definition';assert.notEqual(definitionFingerprint(edited),definitionFingerprint(definition));assert.equal(edited.revision,definition.revision);
});
test('application readiness includes required workers and dependency health, while optional failures remain degraded',async()=>{
  const states={web:{running:true,ready:true},queue:{running:true,ready:false},scheduler:{running:true,ready:true}};
  const runtime=new ApplicationServices(definition,drivers(states));assert.equal((await runtime.status()).ready,false);
  states.queue.ready=true;assert.equal((await runtime.status()).ready,true);
  states.web.ready=false;const unavailable=await runtime.status();assert.equal(unavailable.ready,false);assert.equal(unavailable.services.find(service=>service.id==='queue').ready,false);
  states.web.ready=true;states.scheduler={running:false,ready:false};const optional=structuredClone(definition);optional.services.find(service=>service.id==='scheduler').required=false;
  assert.equal((await new ApplicationServices(optional,drivers(states)).status()).ready,true);
  states.web={running:false,ready:false};states.queue={running:false,ready:false};
  const uncertain=drivers(states);uncertain.scheduler.inspect=async()=>{throw Error('Optional service unreachable');};
  assert.equal((await new ApplicationServices(optional,uncertain).status()).running,null,'An unknown optional service cannot be treated as stopped for configuration or backup.');
});
test('service operations follow dependency order, pass configuration and verify stop outcomes',async()=>{
  const states=Object.fromEntries(definition.services.map(service=>[service.id,{running:false,ready:false}])),events=[];
  const runtime=new ApplicationServices(definition,drivers(states,events));
  const values={applicationName:'New application',concurrency:4};await runtime.start(values);
  assert.deepEqual(events.map(event=>event.slice(0,2)),[['start','web'],['start','queue'],['start','scheduler']]);assert.deepEqual(events[1][2],values);
  await runtime.stop();assert.deepEqual(events.slice(3),[['stop','scheduler'],['stop','queue'],['stop','web']]);assert.equal((await runtime.status()).running,false);
  const broken=drivers(states);broken.web.stop=async()=>{};states.web={running:true,ready:true};await assert.rejects(()=>new ApplicationServices(definition,broken).stop(),/has not stopped/);
});
test('unconfirmed dependency readiness prevents later starts and inspection failure remains unknown',async()=>{
  const states=Object.fromEntries(definition.services.map(service=>[service.id,{running:false,ready:false}])),events=[];
  const provider=drivers(states,events);provider.web.start=async()=>{states.web={running:true,ready:false};};
  const runtime=new ApplicationServices(definition,provider);await assert.rejects(()=>runtime.start(),/readiness/);assert.deepEqual(events,[]);
  provider.web.inspect=async()=>{throw Error('Unreachable runtime');};const status=await runtime.status();assert.equal(status.running,null);assert.equal(status.ready,false);assert.match(status.error,/Unreachable/);
  await assert.rejects(()=>runtime.start(),/Cannot inspect/);assert.deepEqual(events,[]);
});
test('application recovery inspects every service and cannot resolve a partial start from primary readiness',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'lobby-service-recovery-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const fixture=await serviceApp(root),game=await fixture.module.createController({config:fixture.config,env:{},active:null});
  fixture.states.web={running:true,ready:true};fixture.states.queue={running:true,ready:true};
  assert.equal((await game.inspectOperation({action:'start'})).outcome,undefined);assert.deepEqual(fixture.events,[]);
  fixture.states.scheduler={running:true,ready:true};assert.equal((await game.inspectOperation({action:'start'})).outcome,'succeeded');
  assert.equal((await game.inspectOperation({action:'restart'})).outcome,undefined);
  fixture.states.web={running:false,ready:false};fixture.states.queue={running:false,ready:false};fixture.states.scheduler={running:false,ready:false};
  assert.equal((await game.inspectOperation({action:'stop'})).outcome,'succeeded');assert.deepEqual(fixture.events,[]);
});
test('a non-game definition uses real shared HTTP, typed revision checks and named-service lifecycle without frontend code',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'lobby-service-application-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const fixture=await serviceApp(root),token=path.join(root,'token'),auth=path.join(root,'auth');await fs.writeFile(token,'synthetic-service-token');await fs.mkdir(auth);
  await writeJSON(path.join(auth,'users.json'),{Owner:{...hashPassword('service-fixture-password'),role:'admin'},Read:{...hashPassword('service-fixture-password'),role:'member',grants:{standalone:['server.view']}}});
  const env={CONTROLLER_TOKEN_FILE:token,AUTH_DIR:auth,RELEASE_CHECKS:'false',PANEL_HOSTS:'127.0.0.1'};
  const controller=await startController(fixture.module,{env,hostname:'127.0.0.1',port:0,docker:()=>assert.fail('A synthetic application must never contact Docker')});t.after(()=>new Promise(resolve=>{controller.closeAllConnections();controller.close(resolve);}));
  const web=await startWeb(fixture.module,{env:{...env,CONTROLLER_URL:'http://127.0.0.1:'+controller.address().port},hostname:'127.0.0.1',port:0});t.after(()=>new Promise(resolve=>{web.closeAllConnections();web.close(resolve);}));
  const origin='http://127.0.0.1:'+web.address().port;
  const metadata=await(await fetch(origin+'/application-definition.json')).json();assert.equal(metadata.presentation.kind,'application');assert.equal(metadata.application.services.length,3);assert.equal(metadata.application.services[0].profile,undefined);assert.ok(!JSON.stringify(metadata).includes('synthetic-service-token'));
  const entry=await(await fetch(origin+'/app.js')).text();assert.match(entry,/application\/app.js/);assert.ok(!entry.includes('web-stack'));
  async function login(username){const response=await fetch(origin+'/api/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username,password:'service-fixture-password'})});assert.equal(response.status,200);return {session:await response.json(),cookie:response.headers.get('set-cookie').split(';')[0]};}
  const owner=await login('Owner'),read=await login('Read');
  const headers=user=>({origin,cookie:user.cookie,'x-csrf-token':user.session.csrf,'content-type':'application/json'});
  async function request(route,user=owner){const response=await fetch(origin+'/api'+route,{headers:headers(user)});assert.equal(response.status,200);return response.json();}
  async function job(action,params={},user=owner){const response=await fetch(origin+'/api/jobs',{method:'POST',headers:headers(user),body:JSON.stringify({action,params})});if(response.status!==202)return response;const accepted=await response.json();return waitForIdleJob(()=>request('/jobs',user),accepted.id);}
  assert.equal((await fetch(origin+'/api/settings',{headers:headers(read)})).status,403);assert.equal((await job('start',{},read)).status,403);
  const before=await request('/settings'),values={applicationName:'HTTP application',concurrency:5,schedulerEnabled:true};
  assert.equal((await job('save-settings',{values,revision:before.revision})).state,'succeeded');
  const conflict=await job('save-settings',{values:{...values,concurrency:6},revision:before.revision});assert.equal(conflict.state,'failed');assert.match(conflict.message,/changed/);
  const bad=await job('save-settings',{values:{...values,concurrency:999},revision:(await request('/settings')).revision});assert.equal(bad.status,400);
  assert.equal((await job('start')).state,'succeeded');assert.equal((await request('/status')).ready,true);assert.deepEqual(fixture.events,['start:web','start:queue','start:scheduler']);assert.deepEqual(fixture.applied.queue,values);
  const live=await request('/settings');assert.equal(live.editable,false);assert.equal((await job('save-settings',{values,revision:live.revision})).state,'failed');
  assert.equal((await job('stop',{confirm:true})).state,'succeeded');assert.equal((await request('/status')).running,false);assert.equal((await fs.readFile(path.join(fixture.config.data,'payload.txt'),'utf8')),'Disposable application storage sentinel.');
  await writeJSON(path.join(fixture.config.state,'application-definition.json'),{id:definition.id,revision:2});await assert.rejects(()=>fixture.module.validateInstallation(fixture.config),/migration/);
});
