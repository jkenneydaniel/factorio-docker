import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {rust,rustConfiguration} from '../games/rust/index.js';
import {createRust} from '../games/rust/controller.js';
import {createWebRcon,webRcon,sanitizeLogs} from '../games/rust/transport.js';
import {inventory,writeArchive,verifyArchive} from '../games/rust/archive.js';
import {fields,parseSettings,renderSettings,validateSettings} from '../games/rust/settings.js';
import {prepareRust} from '../games/rust/setup.js';
import {startController} from '../core/controller.js';
import {startWeb} from '../core/web.js';
import {hashPassword} from '../auth.js';
import {writeJSON} from '../common.js';
import {waitForIdleJob} from './fixtures.js';
import {selectedGame} from '../games/index.js';
import {BackupRetention} from '../backup-retention.js';

const image='ghcr.io/jkenneydaniel/rust-server:steam-lg.1@sha256:'+'a'.repeat(64),instance='b'.repeat(32),password='isolated_rust_password_123456789012345';
async function fixture(t,{running=true}={}){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'lobby-goblin-rust-test-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const env={RUST_INSTANCE_ID:instance,RUST_CONTAINER:`lobby-goblin-rust-${instance}`,RUST_IMAGE:image,RUST_HOST_DATA:path.join(root,'host-data'),
    RUST_DATA:path.join(root,'rust-data'),RUST_STATE_DIR:path.join(root,'rust-state'),RUST_BACKUPS_DIR:path.join(root,'rust-backups'),RUST_RCON_PASSWORD_FILE:path.join(root,'rcon-password'),
    AUTH_DIR:path.join(root,'auth'),CONTROLLER_TOKEN_FILE:path.join(root,'token'),RELEASE_CHECKS:'false',PANEL_HOSTS:'127.0.0.1'};
  const config=rustConfiguration(env),identityRoot=path.join(config.data,config.identity),calls=[];
  await fs.mkdir(path.join(identityRoot,'cfg'),{recursive:true});await fs.mkdir(env.AUTH_DIR);
  for(const directory of [config.data,config.state,config.backups]){await fs.mkdir(directory,{recursive:true});await writeJSON(path.join(directory,'.lobby-goblin-rust.json'),{game:'rust',instance});}
  await fs.writeFile(path.join(identityRoot,'proceduralmap.4000.123.1.sav'),'Rust save fixture');await fs.writeFile(path.join(identityRoot,'player.blueprints.5.db'),'Blueprint fixture');
  await fs.writeFile(path.join(identityRoot,'player.states.db-wal'),'WAL fixture');await fs.writeFile(path.join(identityRoot,'proceduralmap.4000.123.map'),'Map fixture');
  await fs.writeFile(path.join(identityRoot,'cfg/server.cfg'),'// Existing setting\nserver.hostname "Fixture Rust"\nserver.maxplayers 50\nserver.seed 123\n');
  await fs.writeFile(env.RUST_RCON_PASSWORD_FILE,password);await fs.writeFile(env.CONTROLLER_TOKEN_FILE,'test-token');
  await fs.writeFile(path.join(root,'factorio-world-sentinel.zip'),'do not modify');
  const info={State:{Running:running,Status:running?'running':'exited',ExitCode:0,Health:{Status:'healthy'}},Config:{Image:image,Labels:{'io.lobby-goblin.game':'rust','io.lobby-goblin.instance':instance}},Mounts:[{Type:'bind',Source:config.hostData,Destination:'/steamcmd/rust'}],HostConfig:{RestartPolicy:{Name:'unless-stopped'}},NetworkSettings:{Networks:{isolated:{IPAddress:'192.0.2.2'}}}};
  let failSave=false,failStatus=false,players=[{SteamID:'76561198000000001',DisplayName:'Builder <one>',Ping:31,ConnectedSeconds:125,Address:'private-player-ip'}];
  const docker=async(method,route)=>{
    calls.push([method,route]);assert.ok(route.startsWith('/containers/'+config.container+'/'),'Rust must only address its owned container');
    if(route.endsWith('/json'))return structuredClone(info);
    if(route.includes('/stats?'))return {cpu_stats:{cpu_usage:{total_usage:10},system_cpu_usage:100,online_cpus:2},precpu_stats:{cpu_usage:{total_usage:1},system_cpu_usage:10},memory_stats:{usage:2*1024**3}};
    if(route.includes('/logs?'))return Buffer.from('Rust ready\nrcon.password '+password+'\nsecret echo '+password+'\n');
    if(method==='POST'&&route.endsWith('/stop?t=-1')){info.State.Running=false;info.State.Status='exited';return null;}
    if(method==='POST'&&route.endsWith('/start')){info.State.Running=true;info.State.Status='running';return null;}
    assert.fail('Unexpected mock Docker call: '+method+' '+route);
  };
  const rcon=async options=>{
    calls.push(['RCON',options.command]);assert.equal(options.password,password);assert.equal(options.host,'192.0.2.2');
    if(failStatus)throw Error('Unavailable');
    if(options.command==='server.save'){if(failSave)throw Error('Save command failed.');return 'Saving';}
    if(options.command==='serverinfo')return JSON.stringify({Hostname:'Fixture Rust',Players:1,MaxPlayers:50,Framerate:60,Memory:2048,Uptime:3600});
    if(options.command==='playerlist')return JSON.stringify(players);
    assert.fail('Unexpected Rust command: '+options.command);
  };
  const module={...rust,createController:ctx=>createRust(ctx,{rcon,readyTimeout:5,pollInterval:1})};
  const controller=await startController(module,{env,docker,port:0,hostname:'127.0.0.1'});
  t.after(()=>new Promise(resolve=>{controller.closeAllConnections();controller.close(resolve);}));
  const origin=`http://127.0.0.1:${controller.address().port}`;
  const request=(route,body)=>fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer test-token','content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const submit=async(action,params={})=>{const result=await request('/jobs',{action,params});assert.equal(result.status,202,await result.clone().text());return result.json();};
  const settle=job=>waitForIdleJob(async()=>await(await request('/jobs')).json(),job.id);
  return {root,env,config,identityRoot,info,calls,module,request,submit,settle,origin,failSave:value=>{failSave=value;},failStatus:value=>{failStatus=value;},players:value=>{players=value;}};
}

test('Rust registry is explicit and configuration cannot inherit Factorio settings',()=>{
  assert.equal(selectedGame().id,'factorio');assert.equal(selectedGame('rust').id,'rust');
  assert.throws(()=>rustConfiguration({FACTORIO_CONTAINER:'factorio-server',FACTORIO_DATA:'/factorio'}),/separate Rust/);
  const valid={RUST_INSTANCE_ID:instance,RUST_CONTAINER:`lobby-goblin-rust-${instance}`,RUST_IMAGE:image,RUST_HOST_DATA:'/dedicated/rust/data'};
  assert.throws(()=>rustConfiguration({...valid,RUST_CONTAINER:'factorio-server'}),/name must match/);
  assert.throws(()=>rustConfiguration({...valid,RUST_DATA:'/factorio'}),/separate dedicated/);
  assert.throws(()=>rustConfiguration({...valid,RUST_STATE_DIR:'/rust-server/state'}),/separate dedicated/);
  assert.throws(()=>rustConfiguration({...valid,RUST_IMAGE:'didstopia/rust-server:latest'}),/Lobby Goblin/);
});

test('Rust status, players and bounded logs use only the dedicated container',{timeout:10000},async t=>{
  const f=await fixture(t),value=await(await f.request('/status')).json();assert.equal(value.game,'rust');assert.equal(value.ready,true);assert.equal(value.players,1);assert.equal(value.fps,60);
  const players=await(await f.request('/players')).json();assert.equal(players.players[0].name,'Builder <one>');assert.equal(players.players[0].id,'76561198000000001');assert.equal(JSON.stringify(players).includes('private-player-ip'),false);
  const logs=await(await f.request('/logs')).json();assert.match(logs.logs,/Rust ready/);assert.ok(!logs.logs.includes(password));assert.ok(!logs.logs.includes('rcon.password'));
  assert.equal((await f.request('/worlds')).status,404);assert.equal((await f.request('/world-options')).status,404);
  f.failStatus(true);assert.equal((await(await f.request('/status')).json()).ready,false);assert.equal((await f.request('/players')).status,500);
  assert.equal(await fs.readFile(path.join(f.root,'factorio-world-sentinel.zip'),'utf8'),'do not modify');
});

test('Rust requires confirmations, serializes lifecycle, and will not stop after a failed save',{timeout:10000},async t=>{
  const f=await fixture(t);
  assert.equal((await f.request('/jobs',{action:'stop'})).status,400);
  f.failSave(true);assert.equal((await f.settle(await f.submit('stop',{confirm:true}))).state,'failed');assert.ok(!f.calls.some(([,route])=>route.includes('/stop?')));
  f.failSave(false);assert.equal((await f.settle(await f.submit('restart',{confirm:true}))).state,'succeeded');
  const commands=f.calls.filter(([method,route])=>method==='RCON'||method==='POST');
  assert.ok(commands.findIndex(([,value])=>value==='server.save')<commands.findIndex(([,value])=>value.endsWith('/stop?t=-1')));
  assert.ok(commands.findIndex(([,value])=>value.endsWith('/stop?t=-1'))<commands.findIndex(([,value])=>value.endsWith('/start')));
  assert.equal((await f.settle(await f.submit('stop',{confirm:true}))).state,'succeeded');assert.equal(f.info.State.Running,false);
  assert.equal((await f.settle(await f.submit('start'))).state,'succeeded');assert.equal(f.info.State.Running,true);
  assert.equal((await f.request('/update-plan',{})).status,409);
});

test('Rust rejects mismatched labels, image and data mounts before any mutation',{timeout:10000},async t=>{
  const f=await fixture(t);
  for(const mutate of [()=>{f.info.Config.Labels['io.lobby-goblin.game']='factorio';},()=>{f.info.Config.Image='factorio-image';},()=>{f.info.Mounts[0].Source='/factorio-worlds';}]){
    const original=structuredClone(f.info);mutate();const job=await f.settle(await f.submit('stop',{confirm:true}));assert.equal(job.state,'failed');assert.ok(!f.calls.some(([method])=>method==='POST'||method==='RCON'));Object.assign(f.info,original);
  }
});

test('Rust storage markers are checked before shared controller state writes',{timeout:10000},async t=>{
  const f=await fixture(t),jobs=path.join(f.config.state,'jobs.json'),before=await fs.readFile(jobs,'utf8');
  await writeJSON(path.join(f.config.data,'.lobby-goblin-rust.json'),{game:'factorio',instance});
  await assert.rejects(startController(f.module,{env:f.env,port:0,docker:()=>assert.fail('Invalid storage must not reach Docker.')}),/different installation/);
  assert.equal(await fs.readFile(jobs,'utf8'),before);
  assert.equal((await f.request('/status')).status,409);
});

test('Rust settings preserve unlisted values, reject command injection, and require stopped state',{timeout:10000},async t=>{
  const f=await fixture(t),value=await(await f.request('/settings')).json();assert.equal(value.editable,false);
  const values={...value.values,'server.hostname':'A new Rust server'};
  assert.equal((await f.settle(await f.submit('save-settings',{values,revision:value.revision}))).state,'failed');
  await f.settle(await f.submit('stop',{confirm:true}));
  assert.equal((await f.settle(await f.submit('save-settings',{values,revision:value.revision}))).state,'succeeded');
  const text=await fs.readFile(path.join(f.identityRoot,'cfg/server.cfg'),'utf8');assert.match(text,/server.seed 123/);assert.match(text,/A new Rust server/);
  assert.equal((await f.settle(await f.submit('save-settings',{values,revision:value.revision}))).state,'failed','Stale revision must not overwrite newer edits');
  for(const unsafe of ['Hello\nquit','";quit','\\nquit'])assert.throws(()=>validateSettings({...values,'server.hostname':unsafe}));
  assert.throws(()=>validateSettings({...values,'rcon.password':'new-secret'}));
  assert.equal(parseSettings(renderSettings(text,values)).values['server.hostname'],'A new Rust server');
});

test('Rust streaming backups include identity files, verify hashes, resume Rust, and download',{timeout:15000},async t=>{
  const f=await fixture(t);assert.equal((await f.request('/jobs',{action:'backup'})).status,400);
  const result=await f.settle(await f.submit('backup',{confirm:true}));assert.equal(result.state,'succeeded',result.message);assert.equal(f.info.State.Running,true);
  const items=(await(await f.request('/backups')).json()).backups;assert.equal(items.length,1);assert.equal(items[0].validation.ok,true);assert.equal(items[0].validation.files,5);
  const archive=path.join(f.config.backupDir,items[0].relative);assert.equal((await verifyArchive(archive)).identity,'lobby-goblin-rust');
  const listing=await promisify(execFile)('/usr/bin/tar',['-tzf',archive]);assert.match(listing.stdout,/player.blueprints.5.db/);assert.match(listing.stdout,/player.states.db-wal/);assert.match(listing.stdout,/cfg\/server.cfg/);
  const response=await f.request('/download?kind=backup&name='+encodeURIComponent(items[0].relative));assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/gzip');assert.deepEqual(Buffer.from(await response.arrayBuffer()),await fs.readFile(archive));
  const bad=await fs.readFile(archive);bad[Math.floor(bad.length/2)]^=255;const corrupt=path.join(f.root,'corrupt.tar.gz');await fs.writeFile(corrupt,bad);await assert.rejects(verifyArchive(corrupt));
  assert.equal((await f.request('/schedule',{enabled:true,hours:6,keep:4})).status,400);
  assert.equal((await f.request('/schedule',{enabled:true,hours:6,keep:4,confirmDowntime:true})).status,200);
});

test('Rust backup failures do not interrupt a preflight failure, and stopped Rust stays stopped',{timeout:10000},async t=>{
  const f=await fixture(t,{running:false});
  await fs.symlink(path.join(f.root,'factorio-world-sentinel.zip'),path.join(f.identityRoot,'outside.zip'));
  const failed=await f.settle(await f.submit('backup',{confirm:true}));assert.equal(failed.state,'failed');assert.match(failed.message,/symbolic links/);assert.ok(!f.calls.some(([method])=>method==='POST'));
  await fs.unlink(path.join(f.identityRoot,'outside.zip'));
  assert.equal((await f.settle(await f.submit('backup',{confirm:true}))).state,'succeeded');assert.equal(f.info.State.Running,false);
  f.info.State.ExitCode=137;assert.equal((await f.settle(await f.submit('backup',{confirm:true}))).state,'failed');
});

test('Rust resumes after an archive write fails and reports startup failure',{timeout:10000},async t=>{
  const f=await fixture(t),ctx={config:f.config,env:f.env,docker:async(method,route)=>{if(route.endsWith('/stop?t=-1')){f.info.State.Running=false;return;}if(route.endsWith('/start')){f.info.State.Running=true;return;}return structuredClone(f.info);},host:{info:async()=>structuredClone(f.info),control:async action=>{f.calls.push(['CONTROL',action]);f.info.State.Running=action==='start';if(action==='start'&&failResume)available=false;}},active:null};
  let available=true,failResume=false;
  const game=await createRust(ctx,{rcon:async({command})=>{if(!available&&command==='serverinfo')throw Error('Not ready');return command==='serverinfo'?JSON.stringify({Players:0}):'Saved';},readyTimeout:2,pollInterval:1});await game.init();
  await assert.rejects(game.writeBackup(path.join(f.root,'missing/archive.tmp'),'manual'),/ENOENT/);assert.equal(f.info.State.Running,true);assert.deepEqual(f.calls.filter(([type])=>type==='CONTROL').map(([,action])=>action),['stop','start']);
  failResume=true;await assert.rejects(game.writeBackup(path.join(f.root,'missing/archive.tmp'),'manual'),/could not be resumed/);
});

test('Rust preparation refuses existing destinations and creates an independent installation',{timeout:15000},async t=>{
  const parent=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'lobby-goblin-rust-prepare-')));t.after(()=>fs.rm(parent,{recursive:true,force:true}));
  const directory=path.join(parent,'fresh rust'),result=await prepareRust({directory,image});assert.match(result.link,/register=/);
  const env=await fs.readFile(path.join(directory,'.env'),'utf8'),compose=await fs.readFile(path.join(directory,'compose.yaml'),'utf8');
  assert.ok(!env.includes('FACTORIO'));assert.ok(!compose.includes('factorio-server'));assert.match(compose,/GAME_MODULE: rust/);assert.ok(!compose.includes('28016:28016'));
  const secret=await fs.readFile(path.join(directory,'control/secrets/rust-rcon-password'),'utf8');assert.match(await fs.readFile(path.join(directory,'rust.env'),'utf8'),new RegExp(secret.trim()));
  assert.ok((await fs.stat(path.join(directory,'panel/core/controller.js'))).isFile());assert.ok((await fs.stat(path.join(directory,'panel/public/rust/app.js'))).isFile());
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,'panel/package-lock.json'),'utf8')).packages[''].dependencies,JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8')).dependencies);
  await assert.rejects(prepareRust({directory,image}),/EEXIST/);await assert.rejects(prepareRust({directory:path.resolve('nested-rust'),image}),/outside the Factorio checkout/);
  assert.deepEqual(await fs.readdir(path.join(directory,'backups')),['.lobby-goblin-rust.json']);
});

test('Rust archives stream an identity larger than the Factorio ZIP limit',{timeout:30000},async t=>{
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'lobby-goblin-rust-large-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const identityRoot=path.join(root,'identity');await fs.mkdir(identityRoot);
  const save=path.join(identityRoot,'large.sav');await fs.writeFile(save,'save fixture');await fs.truncate(save,513*1024**2);
  const archive=path.join(root,'large.tar.gz');await writeArchive(archive,identityRoot,{identity:'large-fixture',instance,label:'manual'});
  const result=await verifyArchive(archive);assert.equal(result.bytes,513*1024**2);assert.equal(result.files,1);
  assert.ok((await fs.stat(archive)).size<1024**2,'Sparse fixture compresses without filling host disk');
});

test('Rust TAR archives participate in retention without broadening Factorio cleanup',{timeout:10000},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'lobby-goblin-rust-retain-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const policy={enabled:true,days:1,includeManual:false,includeSafety:false};
  for(let n=0;n<5;n++){const file=path.join(root,`old-${n}-scheduled.tar.gz`);await fs.writeFile(file,'archive');await fs.utimes(file,new Date(1000+n),new Date(1000+n));}
  const rustRetention=new BackupRetention({root,file:path.join(root,'rust.json'),extension:'.tar.gz'});await rustRetention.init();assert.equal((await rustRetention.preview(policy)).candidates.length,3);
  const factorioRetention=new BackupRetention({root,file:path.join(root,'factorio.json')});await factorioRetention.init();assert.equal((await factorioRetention.inventory()).length,0);
});

test('Rust web enforces viewer/admin and CSRF boundaries on the real proxy',{timeout:10000},async t=>{
  const f=await fixture(t);await writeJSON(path.join(f.env.AUTH_DIR,'users.json'),{admin:{...hashPassword('test-admin-password'),role:'admin'},viewer:{...hashPassword('test-viewer-password'),role:'viewer'}});
  const server=await startWeb(rust,{env:{...f.env,CONTROLLER_URL:f.origin},port:0,hostname:'127.0.0.1'});t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const origin=`http://127.0.0.1:${server.address().port}`;assert.match(await(await fetch(origin)).text(),/LOBBY GOBLIN/);assert.equal((await fetch(origin+'/map.js')).status,404);
  const login=async username=>{const response=await fetch(origin+'/api/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username,password:`test-${username}-password`})});assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/^rust_session=/);return {cookie:response.headers.get('set-cookie').split(';')[0],...await response.json()};};
  const viewer=await login('viewer'),admin=await login('admin');
  for(const route of ['logs','settings','mods','plugin-config?name=Test.json','download?kind=backup&name=test.tar.gz'])assert.equal((await fetch(origin+'/api/'+route,{headers:{cookie:viewer.cookie}})).status,403);
  assert.equal((await fetch(origin+'/api/players',{headers:{cookie:viewer.cookie}})).status,200);
  const stop=(user,csrf)=>fetch(origin+'/api/jobs',{method:'POST',headers:{origin,cookie:user.cookie,'content-type':'application/json',...(csrf?{'x-csrf-token':user.csrf}:{})},body:JSON.stringify({action:'stop',params:{confirm:true}})});
  for(const user of [viewer,admin])assert.equal((await fetch(origin+'/api/mods-plan',{method:'POST',headers:{origin,cookie:user.cookie,'content-type':'application/json',...(user===viewer?{'x-csrf-token':user.csrf}:{})},body:JSON.stringify({framework:'oxide'})})).status,403);
  assert.equal((await stop(viewer,true)).status,403);assert.equal((await stop(admin,false)).status,403);const response=await stop(admin,true);assert.equal(response.status,202);assert.equal((await f.settle(await response.json())).state,'succeeded');
});

test('WebRCON client correlates replies on a loopback-only WebSocket',{timeout:10000},async t=>{
  const sockets=new Set(),server=http.createServer();server.on('upgrade',(req,socket)=>{
    assert.equal(req.url,'/test_password');sockets.add(socket);socket.on('close',()=>sockets.delete(socket));
    const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
    let buffer=Buffer.alloc(0);socket.on('data',chunk=>{
      buffer=Buffer.concat([buffer,chunk]);if(buffer.length<6)return;const opcode=buffer[0]&15;if(opcode===8){socket.end();return;}
      const size=buffer[1]&127;assert.ok(size<126);if(buffer.length<6+size)return;const mask=buffer.subarray(2,6),payload=Buffer.from(buffer.subarray(6,6+size));for(let n=0;n<size;n++)payload[n]^=mask[n%4];buffer=buffer.subarray(6+size);
      const packet=JSON.parse(payload);assert.equal(packet.Message,'serverinfo');assert.equal(packet.Name,'WebRcon');
      for(const value of [{Identifier:0,Message:'broadcast'},{Identifier:packet.Identifier,Message:'{"Players":3}',Type:'Generic'}]){const data=Buffer.from(JSON.stringify(value));socket.write(Buffer.concat([Buffer.from([129,data.length]),data]));}
    });
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{for(const socket of sockets)socket.destroy();server.close(resolve);}));
  assert.equal(await webRcon({host:'127.0.0.1',port:server.address().port,password:'test_password',command:'serverinfo'}),'{"Players":3}');
});

test('WebRCON releases stalled handshakes and unanswered closes beyond Rust’s per-IP limit',{timeout:10000},async t=>{
  // Rust may not complete either the upgrade or the closing handshake. Keep
  // those server sockets open deliberately; only client cleanup releases them.
  let mode='upgrade',commands=0;const sockets=new Set(),server=http.createServer();
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});});
  server.on('upgrade',(req,socket)=>{
    socket.on('end',()=>socket.end());socket.resume();
    if(mode==='upgrade')return;
    const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
    let buffer=Buffer.alloc(0);socket.on('data',chunk=>{
      buffer=Buffer.concat([buffer,chunk]);if(buffer.length<6)return;const size=buffer[1]&127;if(buffer.length<6+size)return;
      if((buffer[0]&15)!==1)return; // Never answer a WebSocket close.
      const mask=buffer.subarray(2,6),payload=Buffer.from(buffer.subarray(6,6+size));for(let n=0;n<size;n++)payload[n]^=mask[n%4];buffer=buffer.subarray(6+size);
      const packet=JSON.parse(payload);commands++;
      if(mode==='reply'){const data=Buffer.from(JSON.stringify({Identifier:packet.Identifier,Message:'ready'}));socket.write(Buffer.concat([Buffer.from([129,data.length]),data]));}
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{for(const socket of sockets)socket.destroy();server.close(resolve);}));
  const request=()=>webRcon({host:'127.0.0.1',port:server.address().port,password:'test',command:'serverinfo',timeout:100});
  const released=async()=>{for(let n=0;sockets.size&&n<100;n++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(sockets.size,0,'Each completed request must release its TCP connection');};
  await assert.rejects(request(),/timed out/);await released();
  mode='silent';await assert.rejects(request(),/timed out/);await released();
  mode='reply';for(let n=0;n<7;n++){assert.equal(await request(),'ready');await released();}
  assert.equal(commands,8);
});

test('WebRCON reuses one connection, correlates concurrent replies and reconnects without replaying commands',{timeout:10000},async t=>{
  const {WebSocketServer}=await import('ws'),server=new WebSocketServer({host:'127.0.0.1',port:0});
  let connections=0,mutations=0;server.on('connection',socket=>{connections++;const batch=[];socket.on('message',data=>{
    const packet=JSON.parse(data);
    if(packet.Message==='disconnect'){mutations++;socket.terminate();return;}
    if(packet.Message==='silent')return;
    const reply=()=>socket.send(JSON.stringify({Identifier:packet.Identifier,Message:packet.Message}));
    if(packet.Message.startsWith('batch-')){batch.push(reply);if(batch.length===10)for(const send of batch.reverse())send();}else reply();
  });});
  if(!server.address())await new Promise(resolve=>server.once('listening',resolve));
  const client=createWebRcon(),options={host:'127.0.0.1',port:server.address().port,password:'test'};
  t.after(()=>{client.close();for(const socket of server.clients)socket.terminate();return new Promise(resolve=>server.close(resolve));});
  const values=await Promise.all(Array.from({length:10},(_,n)=>client({...options,command:'batch-'+n})));
  assert.deepEqual(values,Array.from({length:10},(_,n)=>'batch-'+n));assert.equal(connections,1);
  await assert.rejects(client({...options,command:'disconnect'}),/closed|unavailable/);assert.equal(mutations,1,'A disconnected command must never be replayed');
  assert.equal(await client({...options,command:'ready'}),'ready');assert.equal(connections,2);
  await assert.rejects(client({...options,command:'silent',timeout:50}),/timed out/);
  assert.equal(await client({...options,command:'ready'}),'ready');assert.equal(connections,3);
});

test('WebRCON hides socket credentials and times out rather than accepting broadcasts',async()=>{
  class Broadcast extends EventTarget{constructor(url){super();assert.match(url,/secret_encoded/);queueMicrotask(()=>this.dispatchEvent(new Event('open')));}send(){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({Identifier:0,Message:'not a reply'})}));}terminate(){}}
  await assert.rejects(webRcon({host:'127.0.0.1',port:1,password:'secret_encoded',command:'serverinfo',Socket:Broadcast,timeout:5}),/timed out/);
  class Broken {constructor(){throw Error('ws://host/password-secret');}}
  await assert.rejects(webRcon({host:'host',port:1,password:'secret_encoded',command:'x',Socket:Broken}),error=>!error.message.includes('password-secret'));
  assert.ok(!sanitizeLogs('rcon.password secret\nvalue secret','secret').includes('secret'));
});

test('Rust start reports process crashes and restart loops without waiting for readiness timeout',async t=>{
  const f=await fixture(t),ctx={config:f.config,env:f.env,host:{info:async()=>structuredClone(f.info),control:async()=>{}},docker:async()=>{throw Error('Unexpected Docker operation');}};
  for(const failure of [()=>{f.info.State.Running=false;},()=>{f.info.RestartCount++;}]){
    f.info.State.Running=true;f.info.RestartCount=0;let attempts=0;
    const adapter=await createRust(ctx,{rcon:async()=>{attempts++;failure();throw Error('Unavailable');},readyTimeout:600000,pollInterval:1});await adapter.init();
    await assert.rejects(adapter.actions.start(),/exited or restarted/);assert.equal(attempts,1);
  }
});

test('a Rust backup downloads completely through the web proxy beyond 30 seconds',{timeout:45000},async t=>{
  const f=await fixture(t);
  const job=await f.settle(await f.submit('backup',{confirm:true}));assert.equal(job.state,'succeeded');
  const item=(await(await f.request('/backups')).json()).backups[0];
  const archive=await fs.readFile(path.join(f.config.backupDir,item.relative));
  // Throttle only this disposable archive on loopback; no real Docker or worlds.
  const slow=http.createServer((req,res)=>{
    assert.ok(req.url.startsWith('/download?'));assert.equal(req.headers.authorization,'Bearer test-token');
    res.writeHead(200,{'content-type':'application/gzip','content-disposition':'attachment; filename="fixture.tar.gz"','content-length':archive.length});
    const size=Math.ceil(archive.length/32);let offset=0;
    const send=()=>{res.write(archive.subarray(offset,offset+size));offset+=size;if(offset>=archive.length){clearInterval(timer);res.end();}};
    const timer=setInterval(send,1000);res.once('close',()=>clearInterval(timer));send();
  });await new Promise(resolve=>slow.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{slow.closeAllConnections();slow.close(resolve);}));
  const web=await startWeb(f.module,{env:{...f.env,CONTROLLER_URL:'http://127.0.0.1:'+slow.address().port},port:0,hostname:'127.0.0.1'});
  t.after(()=>new Promise(resolve=>{web.closeAllConnections();web.close(resolve);}));
  await writeJSON(path.join(f.env.AUTH_DIR,'users.json'),{admin:{...hashPassword('test-admin-password'),role:'admin'}});
  const origin='http://127.0.0.1:'+web.address().port;
  const login=await fetch(origin+'/api/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'test-admin-password'})});assert.equal(login.status,200);
  const started=performance.now(),response=await fetch(origin+'/api/download?kind=backup&name='+encodeURIComponent(item.relative),{headers:{cookie:login.headers.get('set-cookie').split(';')[0]}});
  assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/fixture.tar.gz/);assert.equal(response.headers.get('cache-control'),'no-store');
  const received=Buffer.from(await response.arrayBuffer()),elapsed=performance.now()-started;
  assert.ok(elapsed>30000,'Exercise the actual 30-second boundary');
  assert.equal(crypto.createHash('sha256').update(received).digest('hex'),crypto.createHash('sha256').update(archive).digest('hex'));
  const downloaded=path.join(f.root,'downloaded.tar.gz');await fs.writeFile(downloaded,received);assert.equal((await verifyArchive(downloaded)).files,5);
  t.diagnostic(`Downloaded and verified ${received.length} bytes in ${Math.round(elapsed)} ms.`);
});

test('an early WebRCON reply cannot mark an initializing world ready or permit a save/stop',async t=>{
 const f=await fixture(t);f.info.State.Health.Status='starting';assert.equal((await(await f.request('/status')).json()).ready,false);
 const job=await f.settle(await f.submit('stop',{confirm:true}));assert.equal(job.state,'failed');assert.match(job.message,/finish startup/);assert.ok(!f.calls.some(([method,value])=>method==='POST'||value==='server.save'));
 f.info.State.Health.Status='healthy';assert.equal((await(await f.request('/status')).json()).ready,true);
});
