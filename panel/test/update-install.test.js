import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {UpdateManager} from '../update-manager.js';
import {runUpdate,validateDeployment} from '../update-worker.js';
import {sourceSnapshot,sha256,unpackRelease,initializeUpdateBaseline,daemonPath} from '../update-source.js';
import {writeJSON,readJSON,HttpError} from '../common.js';
import {makeZip} from '../zip.js';

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'fc-update-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const state=path.join(root,'.panel-data/updates');await fs.mkdir(state,{recursive:true});
  const files={'compose.yaml':'name: fixture\n','panel/package.json':'{"version":"0.1.0-alpha"}','panel/Dockerfile':'FROM node:24\n','panel/server.js':'// old panel\n','panel/update-worker.js':'// updater\n','README.md':'old docs\n'};
  for(const [name,data] of Object.entries(files)){await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),data);}
  await fs.writeFile(path.join(root,'.env'),'SERVER_ADDRESS=factory.example\nPANEL_PORT=9080\nPANEL_IMAGE=local/factory-control:old\nFACTORIO_IMAGE=factoriotools/factorio:2.0.77\n');
  for(const name of ['auth','controller','secrets']){await fs.mkdir(path.join(root,'.panel-data',name));await fs.writeFile(path.join(root,'.panel-data',name,'fixture.json'),'original-'+name);}
  await fs.mkdir(path.join(root,'data/saves'),{recursive:true});await fs.writeFile(path.join(root,'data/saves/World.zip'),'real-fixture-world');
  await initializeUpdateBaseline(root);
  const names={game:'fixture-game',controller:'fixture-controller',panel:'fixture-panel'},images={game:'sha256:old-game',controller:'sha256:old-panel',panel:'sha256:old-panel'};
  const id=crypto.randomUUID(),job={id,kind:'panel',target:'0.1.1-alpha',root,project:'fixture',names,images,gameImage:'factoriotools/factorio:2.0.77',state:'running',started:new Date().toISOString(),backup:'verified-before.zip',assets:Object.fromEntries(['.zip','.sha256','.update.json'].map(s=>[s,'https://github.com/example/project/releases/download/v0.1.1-alpha/factory-control-0.1.1-alpha'+s]))};
  const config={services:Object.fromEntries([['factorio','game'],['panel-controller','controller'],['panel','panel']].map(([name,key])=>[name,{container_name:names[key],image:key==='game'?job.gameImage:'local/factory-control:old',platform:key==='game'?'linux/amd64':undefined,volumes:[{type:'bind',source:root+(key==='game'?'/data':'/.panel-data/'+key),target:key==='game'?'/factorio':'/state'}],ports:key==='panel'?[{target:8080,published:'9080',protocol:'tcp'}]:[]}]))};
  const releaseFiles={...files,'panel/package.json':'{"version":"0.1.1-alpha"}','panel/server.js':'// new panel\n'};
  const archive=makeZip(Object.entries(releaseFiles).map(([name,data])=>({name:'factory-control-0.1.1-alpha/'+name,data:Buffer.from(data)})));
  const metadata={format:1,version:job.target,updater:1,stateVersion:1,rollbackSafe:true};
  const calls=[];let failHealth=false,failBuild=false,failPull=false,ready=true,clock=0;
  async function run(args){
    calls.push(args);
    if(args[0]==='inspect')return JSON.stringify([{Image:images[Object.keys(names).find(k=>names[k]===args[1])],State:{Health:{Status:failHealth?'unhealthy':'healthy'}}}]);
    if(args.includes('config')){const value=structuredClone(config),env=await fs.readFile(path.join(root,'.env'),'utf8');value.services.factorio.image=env.match(/^FACTORIO_IMAGE=(.*)$/m)[1];return JSON.stringify(value);}
    if(args[0]==='build'&&failBuild)throw Error('build failed');
    if(args[0]==='pull'&&failPull)throw Error('pull failed');
    if(args[0]==='exec')return ready?'Version: 2.0.78':'unavailable';
    if(args.includes('up')&&args.includes('panel-controller')&&failHealth){failHealth=false;throw Error('health failed');}
    return '';
  }
  const fetcher=async url=>new Response(url.endsWith('.zip')?archive:url.endsWith('.sha256')?sha256(archive)+'  factory-control-0.1.1-alpha.zip\n':JSON.stringify(metadata));
  return {root,state,job,config,archive,metadata,calls,run,fetcher,names,images,async execute(changes={}){Object.assign(job,changes);await writeJSON(path.join(state,id+'.json'),job);return runUpdate({root,state,id,run,fetcher,own:async()=>{},now:()=>clock,wait:async()=>{clock+=60000;}});},failHealth(){failHealth=true;},failBuild(){failBuild=true;},failPull(){failPull=true;},notReady(){ready=false;}};
}
test('verified panel update stages/builds before replacement and never restarts the game',async t=>{
  const f=await fixture(t),result=await f.execute();assert.equal(result.state,'succeeded',result.message);
  assert.match(await fs.readFile(path.join(f.root,'panel/server.js'),'utf8'),/new panel/);
  const env=await fs.readFile(path.join(f.root,'.env'),'utf8');assert.match(env,/PANEL_PORT=9080/);assert.match(env,/PANEL_IMAGE=local\/factory-control:update-/);
  assert.equal(await fs.readFile(path.join(f.root,'data/saves/World.zip'),'utf8'),'real-fixture-world');
  const replacement=f.calls.find(args=>args.includes('up'));assert.deepEqual(replacement.slice(-2),['panel-controller','panel']);assert.ok(replacement.includes('--no-deps'));
  assert.ok(!f.calls.some(args=>args.includes('stop')&&args.includes('factorio')));
  assert.deepEqual((await readJSON(path.join(f.state,'baseline.json'))).files,await sourceSnapshot(f.root));
});
test('failed panel health recovers source, environment and matching previous image without touching world data',async t=>{
  const f=await fixture(t),before=await fs.readFile(path.join(f.root,'.env'),'utf8');f.failHealth();const result=await f.execute();
  assert.equal(result.state,'failed');assert.match(result.message,/previous services restarted/);
  assert.match(await fs.readFile(path.join(f.root,'panel/server.js'),'utf8'),/old panel/);assert.equal(await fs.readFile(path.join(f.root,'.env'),'utf8'),before);
  assert.ok(f.calls.some(args=>args[0]==='tag'&&args[1]===f.images.controller));
  assert.equal(await fs.readFile(path.join(f.root,'data/saves/World.zip'),'utf8'),'real-fixture-world');
});
test('local edits and failed downloads/builds never replace running services',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.root,'README.md'),'local edit');let result=await f.execute();assert.equal(result.state,'failed');assert.match(result.message,/local changes/);assert.equal(f.calls.length,0);
  const g=await fixture(t);g.failBuild();result=await g.execute();assert.equal(result.state,'failed');assert.ok(!g.calls.some(a=>a.includes('up')||a.includes('stop')));assert.match(await fs.readFile(path.join(g.root,'panel/server.js'),'utf8'),/old panel/);
});
test('an edit arriving during a build is preserved when the final baseline check refuses promotion',async t=>{
  const f=await fixture(t),run=async args=>{const result=await f.run(args);if(args[0]==='build')await fs.writeFile(path.join(f.root,'README.md'),'edited while building');return result;};
  await writeJSON(path.join(f.state,f.job.id+'.json'),f.job);
  const result=await runUpdate({root:f.root,state:f.state,id:f.job.id,run,fetcher:f.fetcher,own:async()=>{}});
  assert.equal(result.state,'failed');assert.equal(await fs.readFile(path.join(f.root,'README.md'),'utf8'),'edited while building');assert.ok(!f.calls.some(a=>a.includes('up')));
});
test('game update pulls one pinned amd64 version and verifies its reported version',async t=>{
  const f=await fixture(t),result=await f.execute({kind:'game',target:'2.0.78'});assert.equal(result.state,'succeeded',result.message);
  assert.ok(f.calls.some(a=>a.join(' ')==='pull --platform linux/amd64 factoriotools/factorio:2.0.78'));
  assert.deepEqual(f.calls.find(a=>a.includes('up')).slice(-1),['factorio']);
  assert.match(await fs.readFile(path.join(f.root,'.env'),'utf8'),/FACTORIO_IMAGE=factoriotools\/factorio:2.0.78/);
});
test('failed game download leaves source, configuration and running services unchanged',async t=>{
  const f=await fixture(t),before=await fs.readFile(path.join(f.root,'.env'),'utf8');f.failPull();const result=await f.execute({kind:'game',target:'2.0.78'});
  assert.equal(result.state,'failed');assert.equal(await fs.readFile(path.join(f.root,'.env'),'utf8'),before);assert.ok(!f.calls.some(a=>a.includes('up')||a.includes('stop')));
});
test('failed game readiness preserves upgraded saves and prepares old image stopped for explicit restore',async t=>{
  const f=await fixture(t);f.notReady();const result=await f.execute({kind:'game',target:'2.0.78'});assert.equal(result.state,'failed');assert.match(result.recovery.action,/Restore the pre-update backup explicitly/i);
  assert.ok(f.calls.some(a=>a.includes('stop')&&a.at(-1)==='factorio'));assert.ok(f.calls.some(a=>a.includes('create')&&a.at(-1)==='factorio'));
  assert.equal(await fs.readFile(path.join(f.root,'data/saves/World.zip'),'utf8'),'real-fixture-world');
});
test('release validation refuses bad checksums, private paths and incompatible state migrations',async t=>{
  const f=await fixture(t),checksum=sha256(f.archive)+'  factory-control-0.1.1-alpha.zip\n';
  assert.throws(()=>unpackRelease(f.archive,'0'.repeat(64)+'  factory-control-0.1.1-alpha.zip\n',f.job.target,f.metadata),/checksum/);
  assert.throws(()=>unpackRelease(f.archive,checksum,f.job.target,{...f.metadata,stateVersion:2}),/migration/);
  const archive=makeZip([{name:'factory-control-0.1.1-alpha/.env',data:Buffer.from('private')}]);assert.throws(()=>unpackRelease(archive,sha256(archive)+'  factory-control-0.1.1-alpha.zip\n',f.job.target,f.metadata),/Unexpected release path/);
  const after=structuredClone(f.config);after.services.panel.ports=[];assert.throws(()=>validateDeployment(f.config,after,f.job),/ports/);
});
test('update review expires, backup failures block workers, and accepted work survives a new manager',async t=>{
  const f=await fixture(t),calls=[];let backupFails=true,worker=false,clock=100;
  const docker=async(method,route,body)=>{
    calls.push({method,route,body});
    if(route.includes('factory-control-update-')&&method==='GET'){if(!worker)throw new HttpError(404,'missing');return {State:{Running:true}};}
    if(route.endsWith('/json')){const name=decodeURIComponent(route.split('/')[2]),key=Object.keys(f.names).find(k=>f.names[k]===name);return {Image:f.images[key],Config:{Image:key==='game'?f.job.gameImage:'local/old',Labels:{'com.docker.compose.project':'fixture','com.docker.compose.service':{game:'factorio',controller:'panel-controller',panel:'panel'}[key],'com.docker.compose.project.working_dir':f.root,'com.docker.compose.project.config_files':f.root+'/compose.yaml'}},Mounts:[{Type:'bind',Source:f.root+'/data',Destination:'/factorio'}]};}
    if(route.startsWith('/containers/create')){worker=true;return {Id:'worker'};}return null;
  };
  const options={root:f.state,docker,backup:async()=>{if(backupFails)throw Error('backup failed');return 'verified.zip';},current:'0.1.0-alpha',names:f.names,now:()=>clock};
  const manager=new UpdateManager(options);await manager.init();let plan=await manager.plan({kind:'game',target:'2.0.78'});
  clock+=16*60000;await assert.rejects(manager.install({planId:plan.id,confirm:true},'admin'),/expired/);
  plan=await manager.plan({kind:'game',target:'2.0.78'});await assert.rejects(manager.install({planId:plan.id,confirm:true},'admin'),/backup failed/);assert.ok(!calls.some(c=>c.route.startsWith('/containers/create')));
  backupFails=false;plan=await manager.plan({kind:'game',target:'2.0.78'});const job=await manager.install({planId:plan.id,confirm:true},'admin');assert.equal(job.state,'running');
  const created=calls.find(c=>c.route.startsWith('/containers/create')).body;assert.equal(created.Image,f.images.controller);assert.equal(created.HostConfig.AutoRemove,false);assert.equal(created.User,'0:0');
  const restarted=new UpdateManager(options);await restarted.init();assert.equal(restarted.busy,true);await assert.rejects(restarted.plan({kind:'game',target:'2.0.79'}),/current operation/);
});
test('source and host path checks reject symlink escapes and preserve Windows Docker Desktop mapping',async t=>{
  const f=await fixture(t);await fs.symlink(os.tmpdir(),path.join(f.root,'panel/escape'));await assert.rejects(sourceSnapshot(f.root),/symlink/);
  assert.equal(daemonPath('C:\\Factory\\data'),'/run/desktop/mnt/host/c/Factory/data');assert.throws(()=>daemonPath('/host/../escape'),/path/);
});
