import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {catalog,validateCreation,resources,labels} from '../fleet/catalog.js';import {runWorker} from '../fleet/worker.js';import {publishSnapshot,verifySnapshot,hashFile} from '../fleet/snapshots.js';import {writeArchive} from '../games/rust/archive.js';import {makeZip} from '../core/archive.js';import {ownedDocker} from '../fleet/owned-docker.js';import {dataMount} from '../core/data-mount.js';import {FleetManager} from '../fleet/manager.js';import {startFleetWeb} from '../fleet/web.js';import {writeJSON,readJSON} from '../common.js';import {hashPassword} from '../auth.js';
import {waitForIdleJob} from './fixtures.js';
const fleet='a'.repeat(32),one='b'.repeat(32),two='c'.repeat(32),snap='d'.repeat(32),token='e'.repeat(64);
const world=makeZip([{name:'world/level.dat',data:Buffer.from('disposable world content')}]);
async function fixture(t){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'lobby-fleet-test-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));const library=path.join(root,'library');await fs.mkdir(library);return {root,library};}
async function directory(root,name){const p=path.join(root,name);await fs.mkdir(p,{recursive:true});return p;}
const provision=(id,game='factorio',extra={})=>({action:'provision',fleet,id,game,name:'Private test server',image:catalog[game].image,seed:456,worldSize:1000,maxPlayers:7,controllerToken:id.repeat(2),rconPassword:id+'different_rcon_password_1234567890',...extra});
async function factorioBackup(instance){const file=path.join(instance,'backup.zip');await fs.writeFile(file,makeZip([{name:'saves/world.zip',data:world},{name:'config/rconpw',data:Buffer.from('NEVER_SHARE_THIS_SECRET')},{name:'config/server-adminlist.json',data:Buffer.from('["private-admin"]')},{name:'mods/mod-list.json',data:Buffer.from('{"mods":[{"name":"base","enabled":true}]}')},{name:'panel-manifest.json',data:Buffer.from(JSON.stringify({activeSave:'world.zip'}))}]));return file;}
test('creation rejects commands, unsupported games, resource overcommit inputs and caller image overrides',()=>{
 assert.equal(validateCreation({game:'factorio',name:'Friday'}).memoryGiB,2);assert.equal(validateCreation({game:'rust',name:'Island'}).memoryGiB,12);
 for(const input of [{game:'other',name:'x'},{game:'factorio',name:'name\nquit'},{game:'rust',name:'x',memoryGiB:2},{game:'factorio',name:'x',cpu:.7},{game:'rust',name:'x',worldSize:1337},{game:'factorio',name:'x',seed:0}])assert.throws(()=>validateCreation(input));
 const value=validateCreation({game:'factorio',name:'Friday',image:'evil/image',hostPath:'/production'});assert.equal(value.image,undefined);assert.equal(value.hostPath,undefined);
});
test('Factorio snapshots strip credentials and clone into independent initialized storage',async t=>{
 const f=await fixture(t),a=await directory(f.root,'a'),b=await directory(f.root,'b');await runWorker(provision(one),{instance:a,library:f.library});
 const backup=await factorioBackup(a),result=await publishSnapshot({library:f.library,backup,record:{id:snap,sourceId:one,title:'Shared world',sourceName:'Source',game:'factorio',image:catalog.factorio.image}});
 const manifest=await verifySnapshot(f.library,snap,result.manifestSha256);assert.deepEqual(manifest.files.map(f=>f.name),['mods/mod-list.json','world.zip']);assert.equal(manifest.credentialsIncluded,false);
 await runWorker(provision(two,'factorio',{snapshotId:snap,snapshotHash:result.manifestSha256}),{instance:b,library:f.library});assert.deepEqual(await fs.readFile(path.join(b,'data/saves/world.zip')),world);
 assert.equal(await fs.stat(path.join(a,'data/config/rconpw')).catch(()=>null),null,'fresh boot must not look like a broken existing identity');const oldPassword=provision(one).rconPassword,newPassword=await fs.readFile(path.join(b,'data/config/rconpw'),'utf8');assert.notEqual(oldPassword,newPassword);assert.ok(!newPassword.includes('NEVER_SHARE'));
 await fs.writeFile(path.join(b,'data/saves/world.zip'),'changed clone');assert.deepEqual(await fs.readFile(path.join(f.library,snap,'content/world.zip')),world);assert.equal((await readJSON(path.join(a,'.fleet-owner.json'))).id,one);
 await assert.rejects(runWorker(provision(two),{instance:a,library:f.library}),/empty, unowned/);
});
test('snapshot tampering and incompatible games fail before any cloned world is written',async t=>{
 const f=await fixture(t),a=await directory(f.root,'a'),b=await directory(f.root,'b');const backup=await factorioBackup(a),result=await publishSnapshot({library:f.library,backup,record:{id:snap,sourceId:one,title:'Shared',game:'factorio',image:catalog.factorio.image}});
 await fs.appendFile(path.join(f.library,snap,'content/world.zip'),'corrupt');await assert.rejects(verifySnapshot(f.library,snap,result.manifestSha256),/hashes/);
 await assert.rejects(runWorker(provision(two,'factorio',{snapshotId:snap,snapshotHash:result.manifestSha256}),{instance:b,library:f.library}),/hashes/);assert.deepEqual(await fs.readdir(path.join(b,'data/saves')),[]);
});
test('Rust snapshot clones preserve world/player data and replace config and credentials',async t=>{
 const f=await fixture(t),source=await directory(f.root,'identity'),a=await directory(f.root,'a');await fs.mkdir(path.join(source,'cfg'));await fs.writeFile(path.join(source,'cfg/server.cfg'),'rcon.password private_rcon\nserver.hostname Old');await fs.writeFile(path.join(source,'cfg/users.cfg'),'private administrator');await fs.writeFile(path.join(source,'proceduralmap.1000.456.289.sav'),'real-format-is-separate-runtime-test');await fs.writeFile(path.join(source,'player.blueprints.5.db'),'blueprints');
 const backup=path.join(f.root,'rust.tar.gz');await writeArchive(backup,source,{identity:'lobby-goblin-rust',instance:one,label:'test'});const result=await publishSnapshot({library:f.library,backup,record:{id:snap,sourceId:one,title:'Island',game:'rust',image:catalog.rust.image,seed:456,worldSize:1000}});
 const manifest=await verifySnapshot(f.library,snap,result.manifestSha256);assert.equal(manifest.includesPlayerData,true);assert.equal(manifest.seed,456);assert.ok(manifest.files.every(file=>!file.name.includes('/cfg/')));
 await runWorker(provision(two,'rust',{snapshotId:snap,snapshotHash:result.manifestSha256}),{instance:a,library:f.library});assert.equal(await fs.readFile(path.join(a,'data/server/lobby-goblin-rust/player.blueprints.5.db'),'utf8'),'blueprints');const cfg=await fs.readFile(path.join(a,'data/server/lobby-goblin-rust/cfg/server.cfg'),'utf8');assert.match(cfg,/Private test server/);assert.ok(!cfg.includes('private_rcon'));assert.equal((await readJSON(path.join(a,'data/server/.lobby-goblin-rust.json'))).instance,two);
});
test('named-volume workers stay under their game data; standalone bind normalization remains supported',()=>{
 const server={Mounts:[{Type:'volume',Name:'own-volume',Destination:'/factorio'}],HostConfig:{Mounts:[{Type:'volume',Source:'own-volume',Target:'/factorio',VolumeOptions:{Subpath:'data'}}]}};assert.deepEqual(dataMount(server,'.panel-work/job').VolumeOptions,{NoCopy:true,Subpath:'data/.panel-work/job'});assert.throws(()=>dataMount(server,'../other'));
 assert.equal(dataMount({Mounts:[{Type:'bind',Source:'C:\\games\\own',Destination:'/factorio'}]},'.panel-work/job').Source,'/run/desktop/mnt/host/c/games/own/.panel-work/job');
});
test('a managed controller rejects foreign containers, alternate game IDs, unsafe mounts and global cleanup',async()=>{
 const volume=resources(fleet,one,'factorio').volume,game='lobby-goblin-factorio-'+one,calls=[];
 const owned={Id:'owned-id',Name:'/'+game,Config:{Image:'game@sha256:test',Labels:labels(fleet,one,'factorio')},Image:'image-id',Mounts:[{Type:'volume',Name:volume,Destination:'/factorio'}],HostConfig:{Mounts:[{Type:'volume',Source:volume,Target:'/factorio',VolumeOptions:{Subpath:'data'}}]}};
 const request=async(method,route,data)=>{calls.push({method,route,data});if(route.includes('/json')&&route.startsWith('/containers/')&&!route.startsWith('/containers/json'))return route.includes('foreign')?{...owned,Config:{...owned.Config,Labels:{}}}:structuredClone(owned);if(route.startsWith('/containers/json'))return [];return {Id:'worker'};};
 const fenced=ownedDocker(request,{FLEET_ID:fleet,FLEET_INSTANCE:one,FLEET_VOLUME:volume,FACTORIO_CONTAINER:game,GAME_MODULE:'factorio'});
 await assert.rejects(fenced('POST','/containers/foreign/stop'),/different installation/);await assert.rejects(fenced('DELETE','/containers/owned-id'),/Unsupported/);assert.equal(calls.filter(c=>c.method!=='GET').length,0);
 await fenced('GET','/containers/json?all=1&filters='+encodeURIComponent(JSON.stringify({label:['factorio-panel.preview=true']})));const filter=JSON.parse(new URL(calls.at(-1).route,'http://docker').searchParams.get('filters'));assert.ok(filter.label.includes('io.lobby-goblin.instance='+one));
 const data={Image:'image-id',HostConfig:{NetworkMode:'none',Memory:1024**3,Mounts:[{Type:'volume',Source:'foreign',Target:'/factorio',VolumeOptions:{Subpath:'data/.panel-work/test'}}]}};await assert.rejects(fenced('POST','/containers/create?name=test',data),/outside/);data.HostConfig.Mounts[0].Source=volume;await fenced('POST','/containers/create?name=test',data);assert.equal(calls.at(-1).data.Labels['io.lobby-goblin.instance'],one);assert.equal(calls.at(-1).data.HostConfig.NanoCpus,1e9);
 await assert.rejects(fenced('DELETE','/volumes/foreign'),/cannot operate/);
});
async function fakeManager(t){
 const f=await fixture(t),root=await directory(f.root,'state'),volumes=new Map(),containers=new Map(),networks=new Map(),calls=[];const host='host-test';containers.set(host,{Id:'host-id',Image:'sha256:manager-runtime',Config:{Labels:{'io.lobby-goblin.fleet':fleet,'io.lobby-goblin.role':'host-controller'}},State:{Running:true}});
 const docker=async(method,route,data)=>{calls.push({method,route,data});const u=new URL(route,'http://docker'),bits=u.pathname.split('/').filter(Boolean).map(decodeURIComponent);const missing=()=>{throw Object.assign(Error('Not found'),{status:404});};if(route==='/info')return {OSType:'linux',Architecture:'x86_64',ServerVersion:'29.0.0',MemTotal:32*1024**3};if(bits[0]==='images'){const reference=bits[1],repo=reference.split('@')[0].slice(0,reference.split('@')[0].lastIndexOf(':'));return {Id:'sha256:'+'f'.repeat(64),Architecture:'amd64',Os:'linux',RepoDigests:[repo+'@sha256:'+'a'.repeat(64)],Config:{Labels:{'io.lobby-goblin.image-revision':reference.includes('rust-server')?'1':'3','factorio.version':'2.0.77','io.lobby-goblin.compatibility':'1','io.lobby-goblin.game':reference.includes('rust-server')?'rust':'factorio'}}};}if(u.pathname==='/containers/json')return u.searchParams.has('filters')?[]:[{Ports:[{Type:'udp',PublicPort:35000}]}];
 if(method==='POST'&&u.pathname==='/volumes/create'){volumes.set(data.Name,data);return data;}if(bits[0]==='volumes')return volumes.get(bits[1])||missing();
 if(method==='POST'&&u.pathname==='/networks/create'){networks.set(data.Name,{...data,Labels:data.Labels,Containers:{}});return {Id:data.Name};}if(bits[0]==='networks'){const n=networks.get(bits[1])||missing();if(method==='GET')return n;if(bits[2]==='connect')n.Containers['host-id']={};if(bits[2]==='disconnect')delete n.Containers['host-id'];if(method==='DELETE')networks.delete(bits[1]);return null;}
 if(method==='POST'&&u.pathname==='/containers/create'){const name=u.searchParams.get('name');containers.set(name,{...data,Name:'/'+name,Id:name,Config:{Image:data.Image,Labels:data.Labels,Env:data.Env},State:{Running:false,ExitCode:0,OOMKilled:false}});return {Id:name};}
 if(bits[0]==='containers'){const c=containers.get(bits[1])||missing();if(method==='GET')return c;if(bits[2]==='start')c.State.Running=true;if(bits[2]==='stop')c.State.Running=false;if(method==='DELETE')containers.delete(bits[1]);return null;}throw Error('Unexpected fake API '+route);};
 const manager=new FleetManager({docker,root,library:f.library,fleet,stateVolume:`lobby-goblin-fleet-${fleet}-state`,libraryVolume:`lobby-goblin-fleet-${fleet}-library`,image:'manager:test',hostContainer:host,memoryBudgetGiB:16});await manager.init();const instanceRoots=new Map();
 manager.helper=async(item,config)=>{let instance=instanceRoots.get(item.id);if(!instance){instance=await directory(f.root,item.id);instanceRoots.set(item.id,instance);}return runWorker({...config,fleet,id:item.id,game:item.game},{instance,library:f.library});};
 // Exercise the real manager.request transport and ownership checks. The child
 // accepts a start job before the game is ready; creation means handoff accepted.
 const childRequests=[];let beforeStart=async()=>{};
 const backend=http.createServer(async(req,res)=>{
  const id=req.headers['x-test-controller'];const item=manager.state.servers.find(item=>item.controller===id);
  assert.ok(item);assert.equal(req.headers.authorization,'Bearer '+item.controllerToken);
  assert.equal(req.method,'POST');assert.equal(req.url,'/jobs');
  let body='';for await(const chunk of req)body+=chunk;
  const value=JSON.parse(body);assert.equal(value.action,'start');assert.equal(value.actor,'administrator');childRequests.push({id,value});
  await beforeStart();res.writeHead(202,{'content-type':'application/json'});res.end(JSON.stringify({id:'child-start',state:'running'}));
 });await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{backend.closeAllConnections();backend.close(resolve);}));
 const realFetch=globalThis.fetch;
 t.mock.method(globalThis,'fetch',(url,options)=>{
  const target=new URL(url);assert.ok(manager.state.servers.some(item=>item.controller===target.hostname));
  return realFetch('http://127.0.0.1:'+backend.address().port+target.pathname,{...options,headers:{...options.headers,'x-test-controller':target.hostname}});
 });
 const settled=async job=>{
  const result=await waitForIdleJob(async()=>({jobs:manager.state.jobs,active:manager.active}),job.id,{attempts:1000,pause:()=>new Promise(resolve=>setTimeout(resolve,10))});
  await manager.queue; // include the final registry write before fixture cleanup
  return result;
 };
 async function submit(input){const job=await settled(await manager.submit('create',input));assert.equal(job.state,'succeeded',job.message);return manager.server(job.result.serverId);}
 return {...f,manager,submit,settled,calls,containers,volumes,networks,instanceRoots,childRequests,holdStart:callback=>{beforeStart=callback;}};
}
test('host creation reserves unique storage/secrets/ports and never changes unrelated servers',async t=>{
 const f=await fakeManager(t),first=await f.submit({game:'factorio',name:'First'}),second=await f.submit({game:'factorio',name:'Second',autoStart:false});assert.notEqual(first.volume,second.volume);assert.notEqual(first.controllerToken,second.controllerToken);assert.notEqual(first.rconPassword,second.rconPassword);assert.equal(first.gamePort,35003);assert.equal(second.gamePort,35006);
 const game=f.containers.get(first.container);assert.ok(game.Env.includes('GENERATE_NEW_SAVE=false'),'world switches must never trigger empty-world generation');assert.equal(game.HostConfig.Mounts[0].VolumeOptions.Subpath,'data');assert.equal(game.HostConfig.Memory,2*1024**3);assert.equal(f.containers.get(second.container).HostConfig.RestartPolicy.Name,'no');assert.equal(f.containers.get(first.controller).Image,'sha256:manager-runtime');
 assert.ok(!JSON.stringify(f.manager.list()).includes(first.controllerToken));assert.ok(!f.calls.some(c=>c.method!=='GET'&&/factorio-server|production/.test(c.route)));
 const job=await f.manager.submit('create',{game:'rust',name:'Over budget',memoryGiB:12});await f.settled(job);assert.equal(job.state,'failed');assert.match(job.message,/budget/);assert.equal(f.manager.state.servers.length,2);
});
test('host creation stays active until the child accepts start and persists the completed handoff',{timeout:15000},async t=>{
 const f=await fakeManager(t);let release,entered;
 const held=new Promise(resolve=>{release=resolve;}),requested=new Promise(resolve=>{entered=resolve;});t.after(()=>release());
 f.holdStart(async()=>{entered();await held;});
 const job=await f.manager.submit('create',{game:'factorio',name:'Slow controller'});
 await requested;await new Promise(resolve=>setTimeout(resolve,650));
 assert.equal(job.state,'running');assert.equal(f.manager.state.servers[0].state,'starting');
 await assert.rejects(f.manager.submit('create',{game:'factorio',name:'Overlap'}),/current host operation/);
 release();const result=await f.settled(job);assert.equal(result.state,'succeeded',result.message);
 const item=f.manager.server(result.result.serverId);assert.equal(item.state,'installed');
 assert.equal(f.childRequests.length,1);assert.equal(f.containers.get(item.container).State.Running,true);
 const saved=await readJSON(path.join(f.manager.root,'registry.json'));
 assert.equal(saved.jobs.find(j=>j.id===job.id).state,'succeeded');assert.equal(saved.servers[0].state,'installed');
});
test('host registry refuses another fleet marker before Docker mutations',async t=>{const f=await fixture(t),root=await directory(f.root,'state');await writeJSON(path.join(root,'.fleet-owner.json'),{fleet:'f'.repeat(32)});const m=new FleetManager({docker:()=>assert.fail('Must not call Docker'),root,library:f.library,fleet,stateVolume:`lobby-goblin-fleet-${fleet}-state`,libraryVolume:`lobby-goblin-fleet-${fleet}-library`,image:'test',hostContainer:'test'});await assert.rejects(m.init(),/another installation/);});
test('one fleet login opens scoped game controls; viewer/CSRF boundaries survive delegation',async t=>{
 const f=await fixture(t),auth=await directory(f.root,'auth'),tokenFile=path.join(f.root,'token');await fs.writeFile(tokenFile,token);await writeJSON(path.join(auth,'users.json'),{admin:{...hashPassword('test-admin-password'),role:'admin'},viewer:{...hashPassword('test-viewer-password'),role:'viewer'}});
 const forwarded=[];const backend=http.createServer(async(req,res)=>{assert.equal(req.headers.authorization,'Bearer '+token);const route=req.url;res.setHeader('content-type','application/json');if(route==='/servers/'+one)return res.end(JSON.stringify({id:one,game:'factorio',state:'installed'}));if(route==='/update-status')return res.end(JSON.stringify({busy:false}));if(route==='/servers/'+one+'/controller/status')return res.end(JSON.stringify({ready:true,players:[]}));if(route==='/servers/'+one+'/controller/jobs'){let body='';for await(const b of req)body+=b;forwarded.push(JSON.parse(body));res.statusCode=202;return res.end('{"id":"job"}');}if(route==='/host-settings')return res.end(JSON.stringify({memoryBudgetGiB:24}));if(route==='/catalog')return res.end(JSON.stringify({games:Object.values(catalog)}));res.statusCode=404;res.end('{"error":"Not found"}');});await new Promise(r=>backend.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{backend.closeAllConnections();backend.close(r);}));
 const server=await startFleetWeb({env:{AUTH_DIR:auth,CONTROLLER_TOKEN_FILE:tokenFile,CONTROLLER_URL:'http://127.0.0.1:'+backend.address().port,PANEL_HOSTS:'127.0.0.1'},port:0,hostname:'127.0.0.1'});t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));const origin='http://127.0.0.1:'+server.address().port;
 const login=async name=>{const r=await fetch(origin+'/api/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username:name,password:'test-'+name+'-password'})});assert.equal(r.status,200);return {cookie:r.headers.get('set-cookie').split(';')[0],...await r.json()};};const admin=await login('admin'),viewer=await login('viewer');
 const html=await fetch(origin+'/servers/'+one+'/',{headers:{cookie:admin.cookie}});assert.equal(html.status,200);const text=await html.text();assert.ok(text.includes(`/servers/${one}/app.js`));assert.ok(text.includes('All servers'));assert.ok(!text.includes(token));const childSession=await fetch(origin+`/servers/${one}/api/session`,{headers:{cookie:admin.cookie}});assert.equal((await childSession.json()).username,'admin');
 const post=(user,csrf)=>fetch(origin+`/servers/${one}/api/jobs`,{method:'POST',headers:{origin,cookie:user.cookie,'content-type':'application/json',...(csrf?{'x-csrf-token':user.csrf}:{})},body:JSON.stringify({action:'start',actor:'forged'})});assert.equal((await post(viewer,true)).status,403);assert.equal((await post(admin,false)).status,403);assert.equal((await post(admin,true)).status,202);assert.equal(forwarded[0].actor,'admin');
 const create=await fetch(origin+'/api/servers',{method:'POST',headers:{origin,cookie:viewer.cookie,'x-csrf-token':viewer.csrf,'content-type':'application/json'},body:'{}'});assert.equal(create.status,403);
 const settingsPost=(user,csrf)=>fetch(origin+'/api/host-settings',{method:'POST',headers:{origin,cookie:user.cookie,'content-type':'application/json',...(csrf?{'x-csrf-token':user.csrf}:{})},body:JSON.stringify({memoryBudgetGiB:24,revision:0})});
 assert.equal((await fetch(origin+'/api/host-settings')).status,401);assert.equal((await fetch(origin+'/api/host-settings',{headers:{cookie:viewer.cookie}})).status,200);assert.equal((await settingsPost(viewer,true)).status,403);assert.equal((await settingsPost(admin,false)).status,403);assert.equal((await settingsPost(admin,true)).status,200);

});

 test('restart reconnects registered owned bridges and removal preserves volumes and library entries',async t=>{
 const f=await fakeManager(t),a=await f.submit({game:'factorio',name:'One'}),b=await f.submit({game:'factorio',name:'Two'});
 f.networks.get(a.network).Containers={};f.networks.get(b.network).Containers={};await f.manager.reconnect();assert.ok(f.networks.get(a.network).Containers['host-id']);assert.ok(f.networks.get(b.network).Containers['host-id']);
 f.containers.get(a.container).State.Running=false;const job=await f.manager.submit('remove',{serverId:a.id,name:a.name,confirm:true});await f.settled(job);assert.equal(job.state,'succeeded',job.message);assert.ok(f.volumes.has(a.volume));assert.ok(!f.containers.has(a.container));assert.ok(!f.networks.has(a.network));assert.ok(f.containers.get(b.container).State.Running);assert.ok(f.networks.has(b.network));assert.equal(a.state,'removed');
 });
 test('creation failure preserves its volume and records attention without changing a neighboring server',async t=>{const f=await fakeManager(t),a=await f.submit({game:'factorio',name:'Neighbor'});f.manager.helper=async()=>{throw Error('disposable failure');};const job=await f.manager.submit('create',{game:'factorio',name:'Interrupted'});await f.settled(job);assert.equal(job.state,'failed');const b=f.manager.state.servers.at(-1);assert.equal(b.state,'attention');assert.ok(f.volumes.has(b.volume));assert.ok(f.containers.get(a.container).State.Running);});

test('saved world presets are scoped by account and server and are removed with their account',async t=>{
 const f=await fixture(t),root=await directory(f.root,'accounts');const {Accounts}=await import('../games/factorio/accounts.js');const accounts=new Accounts(root);
 for(const username of ['Owner','Other']){const invite=await accounts.invite('admin','test');await accounts.register({token:invite.token,username,password:'temporary long test password'});}
 const configuration=JSON.parse(await fs.readFile(new URL('../world-defaults.json',import.meta.url),'utf8'));
 await accounts.worldSetups('Owner',{operation:'save-preset',revision:0,name:'Only in first server',configuration,image:catalog.factorio.image},one);
 assert.equal((await accounts.worldSetups('Owner',undefined,one)).presets.length,1);assert.equal((await accounts.worldSetups('Owner',undefined,two)).presets.length,0);assert.equal((await accounts.worldSetups('Other',undefined,one)).presets.length,0);assert.equal((await accounts.worldSetups('Owner')).presets.length,0);
 await accounts.worldSetups('Owner',{operation:'save-preset',revision:0,name:'Only in second server',configuration,image:catalog.factorio.image},two);assert.equal((await accounts.worldSetups('Owner',undefined,one)).presets[0].name,'Only in first server');
 await accounts.update({username:'Owner',operation:'delete',confirm:true});assert.deepEqual(await fs.readdir(path.join(root,'world-setups')),[]);
});

test('a higher host budget admits default Rust while existing Factorio limits and runtime are unchanged',async t=>{
 const f=await fakeManager(t),first=await f.submit({game:'factorio',name:'Existing factory',memoryGiB:3});const before=structuredClone(f.containers.get(first.container));
 await f.manager.updateHostSettings({memoryBudgetGiB:24,revision:0});const rust=await f.submit({game:'rust',name:'New island',memoryGiB:12});assert.equal(rust.state,'installed');assert.deepEqual(f.containers.get(first.container),before);assert.equal((await f.manager.hostSettings()).allocatedMemoryGiB,17);
});
