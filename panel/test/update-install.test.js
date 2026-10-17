import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {UpdateManager} from '../update-manager.js';
import {runUpdate,validateDeployment,reportsGameVersion,inspectGameImage} from '../update-worker.js';
import {sourceSnapshot,sha256,unpackRelease,initializeUpdateBaseline,daemonPath} from '../update-source.js';
import {writeJSON,readJSON,HttpError} from '../common.js';
import {makeZip} from '../zip.js';
import {gameSources,parseGameImage} from '../public/game-images.js';

function candidateImage(image){
  const parsed=parseGameImage(image),digest='a'.repeat(64);
  return {Id:'sha256:'+digest,Os:'linux',Architecture:'amd64',RepoDigests:[gameSources[parsed.source].repository+'@sha256:'+digest],Config:{Entrypoint:['/docker-entrypoint.sh'],Volumes:{'/factorio':{}},ExposedPorts:{'34197/udp':{},'27015/tcp':{}},Env:['PUID=845','PGID=845','SAVES=/factorio/saves','CONFIG=/factorio/config','MODS=/factorio/mods','SCENARIOS=/factorio/scenarios','SCRIPTOUTPUT=/factorio/script-output','PORT=34197','RCON_PORT=27015'],Labels:{'factorio.version':parsed.version,...(parsed.source==='factory'?{'io.factory-control.compatibility':'1','io.factory-control.image-revision':String(parsed.revision)}:{})}}};
}
function reviewManager(f){
  const docker=async(method,route)=>{
    assert.equal(method,'GET','Review must not mutate Docker');
    const name=decodeURIComponent(route.split('/')[2]),key=Object.keys(f.names).find(k=>f.names[k]===name);
    return {Image:f.images[key],Config:{Image:key==='game'?f.job.gameImage:'local/old',Labels:{'com.docker.compose.project':'fixture','com.docker.compose.service':{game:'factorio',controller:'panel-controller',panel:'panel'}[key],'com.docker.compose.project.working_dir':f.root,'com.docker.compose.project.config_files':f.root+'/compose.yaml'}},Mounts:[{Type:'bind',Source:f.root+'/data',Destination:'/factorio'}]};
  };
  return new UpdateManager({root:f.state,docker,backup:async()=>{throw Error('Review must not back up');},current:'0.2.1-alpha',names:f.names});
}

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
    if(args[0]==='image'&&args[1]==='inspect'){
      if(args[2]!=='--platform')return JSON.stringify([{Config:{}}]);
      assert.deepEqual(args.slice(2,4),['--platform','linux/amd64'],'Inspect the x86 image configuration on ARM hosts');
      return JSON.stringify([candidateImage(args.at(-1))]);
    }
    if(args[0]==='run')return 'Version: '+job.target+' (build fixture)';
    if(args[0]==='inspect')return JSON.stringify([{Image:images[Object.keys(names).find(k=>names[k]===args[1])],State:{Health:{Status:failHealth?'unhealthy':'healthy'}}}]);
    if(args.includes('config')){const value=structuredClone(config),env=await fs.readFile(path.join(root,'.env'),'utf8');value.services.factorio.image=env.match(/^FACTORIO_IMAGE=(.*)$/m)[1];return JSON.stringify(value);}
    if(args[0]==='build'&&failBuild)throw Error('build failed');
    if(args[0]==='pull'&&failPull)throw Error('pull failed');
    if(args[0]==='exec')return ready?job.target+'\n':'unavailable';
    if(args.includes('up')&&args.includes('panel-controller')&&failHealth){failHealth=false;throw Error('health failed');}
    return '';
  }
  const fetcher=async url=>new Response(url.endsWith('.zip')?archive:url.endsWith('.sha256')?sha256(archive)+'  factory-control-0.1.1-alpha.zip\n':JSON.stringify(metadata));
  return {root,state,job,config,archive,metadata,calls,run,fetcher,names,images,async execute(changes={}){Object.assign(job,changes);await writeJSON(path.join(state,id+'.json'),job);return runUpdate({root,state,id,run,fetcher,own:async()=>{},now:()=>clock,wait:async()=>{clock+=60000;}});},failHealth(){failHealth=true;},failBuild(){failBuild=true;},failPull(){failPull=true;},notReady(){ready=false;}};
}
test('image inspection supports classic Docker and selects amd64 metadata from multi-platform stores',async()=>{
  const image='factoriotools/factorio:2.0.77',candidate=candidateImage(image);
  for(const initial of [candidate,{Config:{}},{...candidate,Architecture:'arm64'}]){
    const calls=[],run=async args=>{calls.push(args);return JSON.stringify([args.includes('--platform')?candidate:initial]);};
    assert.deepEqual(await inspectGameImage(image,run),candidate);
    assert.deepEqual(calls[0],['image','inspect',image]);
    assert.equal(calls.length,initial===candidate?1:2);
    if(calls.length===2)assert.deepEqual(calls[1],['image','inspect','--platform','linux/amd64',image]);
  }
  await assert.rejects(inspectGameImage(image,async()=>JSON.stringify([{...candidate,Architecture:'arm64'}])),/linux\/amd64/);
});
test('version readiness accepts real RCON and binary formats while rejecting different or embedded versions',()=>{
  assert.equal(reportsGameVersion('2.0.77\n','2.0.77'),true);
  assert.equal(reportsGameVersion('Version: 2.0.77 (build 84539, linux64, headless)\n','2.0.77'),true);
  for(const value of ['2.0.76','2.0.770','unavailable 2.0.77','Version: 2.0.770'])assert.equal(reportsGameVersion(value,'2.0.77'),false);
});
test('verified panel update stages/builds before replacement and never restarts the game',async t=>{
  const f=await fixture(t),result=await f.execute();assert.equal(result.state,'succeeded',result.message);
  assert.match(await fs.readFile(path.join(f.root,'panel/server.js'),'utf8'),/new panel/);
  const env=await fs.readFile(path.join(f.root,'.env'),'utf8');assert.match(env,/PANEL_PORT=9080/);assert.match(env,/PANEL_IMAGE=local\/factory-control:update-/);
  assert.equal(await fs.readFile(path.join(f.root,'data/saves/World.zip'),'utf8'),'real-fixture-world');
  const replacement=f.calls.find(args=>args.includes('up'));assert.deepEqual(replacement.slice(-2),['panel-controller','panel']);assert.ok(replacement.includes('--no-deps'));
  assert.ok(!f.calls.some(args=>args.includes('stop')&&args.includes('factorio')));
  assert.deepEqual((await readJSON(path.join(f.state,'baseline.json'))).files,await sourceSnapshot(f.root));
});
test('same-version source migration pins the reviewed image digest and preserves world, mods and configuration',async t=>{
  for(const source of ['factory','upstream']){
    const f=await fixture(t),owned=gameSources.factory.repository;
    if(source==='upstream'){
      f.job.gameImage=owned+':2.0.77-fc.1';f.config.services.factorio.image=f.job.gameImage;
      await fs.writeFile(path.join(f.root,'.env'),(await fs.readFile(path.join(f.root,'.env'),'utf8')).replace('factoriotools/factorio:2.0.77',f.job.gameImage));
    }
    for(const file of ['config/server-settings.json','config/rconpw','config/server-id.json','mods/mod-list.json','mods/custom.zip']){await fs.mkdir(path.dirname(path.join(f.root,'data',file)),{recursive:true});await fs.writeFile(path.join(f.root,'data',file),'original-'+file);}
    const result=await f.execute({kind:'game',target:'2.0.77',source,imageRevision:source==='factory'?1:null,targetImage:gameSources[source].repository+':2.0.77'+(source==='factory'?'-fc.1':'')});
    assert.equal(result.state,'succeeded',result.message);
    assert.match(result.resolvedImage,new RegExp('^'+gameSources[source].repository+':2.0.77'+(source==='factory'?'-fc.1':'')+'@sha256:'));
    assert.ok(f.calls.some(a=>a[0]==='pull'&&a.at(-1)===result.targetImage));
    const probe=f.calls.find(a=>a[0]==='run');assert.ok(probe.includes('--read-only'));assert.ok(probe.includes(result.resolvedImage));assert.deepEqual(probe.slice(2,6),['--platform','linux/amd64','--pull','never']);assert.ok(!probe.some(a=>a.includes(f.root)||a==='--mount'||a==='-v'));
    for(const file of ['config/server-settings.json','config/rconpw','config/server-id.json','mods/mod-list.json','mods/custom.zip'])assert.equal(await fs.readFile(path.join(f.root,'data',file),'utf8'),'original-'+file);
    assert.equal(await fs.readFile(path.join(f.root,'data/saves/World.zip'),'utf8'),'real-fixture-world');
    const env=await fs.readFile(path.join(f.root,'.env'),'utf8');assert.ok(env.includes('FACTORIO_IMAGE='+result.resolvedImage));assert.ok(env.includes('PANEL_PORT=9080'));
    assert.equal(f.calls.filter(a=>a.includes('up')).length,1);assert.equal(f.calls.find(a=>a.includes('up')).at(-1),'factorio');
  }
});
test('incompatible candidate images and mismatched review targets fail before replacing any service',async t=>{
  const cases=[
    item=>{item.Architecture='arm64';},
    item=>{item.Config.Labels['factorio.version']='2.0.76';},
    item=>{item.Config.Labels['io.factory-control.compatibility']='2';},
    item=>{item.Config.Env=item.Config.Env.filter(v=>v!=='PUID=845');},
    item=>{item.Config.Entrypoint=['/incompatible'];},
    item=>{item.RepoDigests=[];}
  ];
  for(const tamper of cases){
    const f=await fixture(t),before=await fs.readFile(path.join(f.root,'.env'),'utf8');
    Object.assign(f.job,{kind:'game',target:'2.0.77',source:'factory',imageRevision:1,targetImage:gameSources.factory.repository+':2.0.77-fc.1'});await writeJSON(path.join(f.state,f.job.id+'.json'),f.job);
    const run=async args=>{if(args[0]==='image'){const item=candidateImage(args.at(-1));tamper(item);return JSON.stringify([item]);}return f.run(args);};
    const result=await runUpdate({root:f.root,state:f.state,id:f.job.id,run,own:async()=>{}});
    assert.equal(result.state,'failed');assert.equal(await fs.readFile(path.join(f.root,'.env'),'utf8'),before);assert.ok(!f.calls.some(a=>a.includes('up')||a.includes('stop')));
  }
  const f=await fixture(t),result=await f.execute({kind:'game',target:'2.0.78',targetImage:'untrusted/factorio:2.0.78'});
  assert.equal(result.state,'failed');assert.match(result.message,/reviewed/);assert.ok(!f.calls.some(a=>a[0]==='pull'));
});
test('failed same-version migration keeps failed saves and prepares the previous image stopped',async t=>{
  const f=await fixture(t);f.notReady();const result=await f.execute({kind:'game',target:'2.0.77',source:'factory',imageRevision:1});
  assert.equal(result.state,'failed');assert.equal(result.recovery.requiresWorldRestore,true);
  assert.match(await fs.readFile(path.join(f.root,'.env'),'utf8'),/FACTORIO_IMAGE=factoriotools\/factorio:2.0.77/);
  assert.equal(await fs.readFile(path.join(f.root,'data/saves/World.zip'),'utf8'),'real-fixture-world');
});
test('image replacement validation refuses changes to existing server settings',async t=>{
  const f=await fixture(t),after=structuredClone(f.config);after.services.factorio.environment={DLC_SPACE_AGE:'true'};
  assert.throws(()=>validateDeployment(f.config,after,{...f.job,kind:'game'}),/preserve all existing settings/);
});
test('administrator reviews persist exact provider and revision, retain old-client defaults, and never change data',async t=>{
  const f=await fixture(t),manager=reviewManager(f);await manager.init();
  const plan=await manager.plan({kind:'game',target:'2.0.77',source:'factory',imageRevision:1});
  assert.equal(plan.operation,'image-change');assert.equal(plan.targetImage,gameSources.factory.repository+':2.0.77-fc.1');
  assert.match(plan.notes,/version stays the same/);
  const stored=await readJSON(path.join(f.state,'plan-'+plan.id+'.json'));assert.equal(stored.source,'factory');assert.equal(stored.imageRevision,1);
  const oldClient=await manager.plan({kind:'game',target:'2.0.78'});assert.equal(oldClient.targetImage,'factoriotools/factorio:2.0.78');
  f.job.gameImage=gameSources.factory.repository+':2.0.77-fc.2';
  const upgrade=await manager.plan({kind:'game',target:'2.0.78',imageRevision:1});assert.equal(upgrade.targetImage,gameSources.factory.repository+':2.0.78-fc.1');
  await assert.rejects(manager.plan({kind:'game',target:'2.0.76',source:'upstream'}),/Downgrades/);
  assert.equal(await fs.readFile(path.join(f.root,'data/saves/World.zip'),'utf8'),'real-fixture-world');
});
test('wrong binary version fails the disposable preflight before configuration or containers change',async t=>{
  const f=await fixture(t),before=await fs.readFile(path.join(f.root,'.env'),'utf8');
  Object.assign(f.job,{kind:'game',target:'2.0.77',source:'factory',imageRevision:1});await writeJSON(path.join(f.state,f.job.id+'.json'),f.job);
  const run=async args=>args[0]==='run'?'Version: 2.0.76':f.run(args);
  const result=await runUpdate({root:f.root,state:f.state,id:f.job.id,run,own:async()=>{}});
  assert.equal(result.state,'failed');assert.match(result.message,/binary/);assert.equal(await fs.readFile(path.join(f.root,'.env'),'utf8'),before);assert.ok(!f.calls.some(a=>a.includes('up')||a.includes('stop')));
});
test('panel review prefers complete image sources and falls back to older compatible release assets',async t=>{
  const f=await fixture(t),manager=reviewManager(f);await manager.init();
  const prefix='factory-control-0.2.2-alpha',assets=suffix=>['.zip','.sha256','.update.json'].map(extension=>({name:prefix+suffix+extension,state:'uploaded'}));
  const release={tag_name:'v0.2.2-alpha',assets:[...assets(''),...assets('.source')]};
  manager.releases.check=async()=>{};manager.releases.result={available:true,latest:{tag:release.tag_name}};manager.releases.releases=[release];
  let plan=await manager.plan({kind:'panel'}),stored=await readJSON(path.join(f.state,'plan-'+plan.id+'.json'));
  assert.ok(stored.assets['.zip'].endsWith('.source.zip'));
  release.assets=assets('');plan=await manager.plan({kind:'panel'});stored=await readJSON(path.join(f.state,'plan-'+plan.id+'.json'));
  assert.ok(stored.assets['.zip'].endsWith(prefix+'.zip'));
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

test('failed builds preserve diagnostics in the update record without changing source or services',async t=>{
  const f=await fixture(t),run=async args=>{
    if(args[0]==='build'){
      const error=new Error('Docker build could not verify the registry HTTPS certificate.');
      error.diagnostic={operation:'Docker build',exitCode:1,output:'x509: certificate signed by unknown authority'};
      throw error;
    }
    return f.run(args);
  };
  await writeJSON(path.join(f.state,f.job.id+'.json'),f.job);
  const result=await runUpdate({root:f.root,state:f.state,id:f.job.id,run,fetcher:f.fetcher,own:async()=>{}});
  assert.equal(result.state,'failed');assert.equal(result.failure.exitCode,1);
  assert.match((await readJSON(path.join(f.state,f.job.id+'.json'))).failure.output,/unknown authority/);
  assert.match(await fs.readFile(path.join(f.root,'panel/server.js'),'utf8'),/old panel/);
  assert.ok(!f.calls.some(args=>args.includes('up')||args.includes('stop')));
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
  assert.ok(unpackRelease(f.archive,sha256(f.archive)+'  factory-control-0.1.1-alpha.source.zip',f.job.target,{...f.metadata,bundle:'source'}).size>0);
  assert.throws(()=>unpackRelease(f.archive,checksum,f.job.target,{...f.metadata,bundle:'unknown'}),/migration/);
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

test('panel review rechecks an old controller release cache after a newly detected release',async t=>{
  const f=await fixture(t),manager=reviewManager(f),prefix='factory-control-0.2.2-alpha';
  manager.releases.checked=Date.now()-60001;
  manager.releases.result={state:'current',available:false,latest:{tag:'v0.2.1-alpha'}};
  manager.releases.fetcher=async()=>new Response(JSON.stringify([{tag_name:'v0.2.2-alpha',prerelease:true,published_at:'2026-10-16T23:59:00Z',assets:['.zip','.sha256','.update.json'].map(suffix=>({name:prefix+suffix,state:'uploaded'}))}]));
  const plan=await manager.plan({kind:'panel',target:'0.2.2-alpha'});
  assert.equal(plan.target,'0.2.2-alpha');assert.equal(manager.status().jobs.length,0);
});
