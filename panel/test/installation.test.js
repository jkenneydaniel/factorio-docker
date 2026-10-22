import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {sourceFile} from '../source-layout.js';
const sourceRoot=fileURLToPath(new URL('../../',import.meta.url));
import {optionsFor,installationFiles,prepareInstallation,readInstallation,checkHost,startInstallation,parseArguments,main,installationEnvironment} from '../install.js';
import {panelOrigin,checkOrigin} from '../auth.js';
import {initializePanel} from '../init.js';
import {startFleetWeb} from '../fleet/web.js';
import {welcomeView} from '../public/fleet/onboarding.js';

const version='0.3.5-alpha',template=await fs.readFile(await sourceFile(sourceRoot,'fleet.compose.yaml'),'utf8');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'goblin-install-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
const options=extra=>optionsFor(extra,version);
function dockerFixture({containers='',arch='x86_64',memory=16,rootless=false}={}){
  const calls=[];
  return {calls,execute:async(command,args)=>{assert.equal(command,'docker');calls.push(args);
    if(args[0]==='context')return 'unix:///var/run/docker.sock';
    if(args[0]==='info')return JSON.stringify({OSType:'linux',Architecture:arch,MemTotal:memory*1024**3,ServerVersion:'29.1.0',SecurityOptions:rootless?['name=rootless']:[]});
    if(args[0]==='compose'&&args[1]==='version')return '2.40.0';
    if(args.includes('ps'))return containers;
    if(args.includes('cat'))return 'Private one-time invitation (isolated fixture).';
    return '';
  }};
}
test('local and hosted plans keep backend ports private and isolate certificate storage',()=>{
  const local=installationFiles(options(),template,'a'.repeat(32));
  assert.match(local['.env.install'],/FLEET_PANEL_BIND=127\.0\.0\.1/);
  assert.equal(JSON.parse(local['install.compose.json']).services.gateway,undefined);
  const files=installationFiles(options({mode:'hosted',domain:'games.example.com',address:'play.example.com'}),template,'b'.repeat(32));
  const compose=JSON.parse(files['install.compose.json']);
  assert.equal(compose.services['fleet-web'].environment.PANEL_ORIGIN,'https://games.example.com');
  assert.equal(compose.services['fleet-controller'].environment.FLEET_PANEL_URL,'https://games.example.com');
  assert.deepEqual(compose.services.gateway.ports,['80:80/tcp','443:443/tcp']);
  assert.ok(!compose.services.gateway.volumes.some(value=>value.includes('docker.sock')));
  assert.match(compose.volumes['gateway-data'].name,/^lobby-goblin-fleet-b+-https-data$/);
  assert.match(files['.env.install'],/FLEET_ADDRESS=play.example.com/);
});
test('invalid input cannot inject configuration, change origin or produce unsupported modes',()=>{
  for(const data of [{mode:'remote'},{port:0},{memory:129},{address:'localhost\nFLEET_ID=other'},{mode:'hosted',domain:'https://example.com'},{mode:'hosted',domain:'127.0.0.1'},{mode:'hosted',domain:'foo\nreverse_proxy evil'},{domain:'example.com'},{image:'attacker/panel:latest'}])assert.throws(()=>options(data));
  for(const args of [['--check','--start'],['--memory'],['--unknown'],['--start','--start']])assert.throws(()=>parseArguments(args));
});
test('calling shell settings cannot redirect installation to an existing fleet or override its Compose project',()=>{
  const env=installationEnvironment({PATH:'/fixture',DOCKER_CONTEXT:'local-test',FLEET_ID:'existing',FLEET_IMAGE:'existing:old',COMPOSE_PROJECT_NAME:'live',COMPOSE_FILE:'live.yaml',PANEL_ORIGIN:'http://wrong'});
  assert.deepEqual(env,{PATH:'/fixture',DOCKER_CONTEXT:'local-test'});
});
test('preparation preserves identity and files; mismatches, symlinks and foreign directories fail closed',async t=>{
  const root=await fixture(t),directory=path.join(root,'installation'),foreign=path.join(root,'existing-worlds');await fs.mkdir(foreign);await fs.writeFile(path.join(foreign,'keep.txt'),'unrelated');
  const first=await prepareInstallation(directory,options(),{template});
  const before=await fs.readFile(path.join(directory,'.env.install'),'utf8');
  assert.equal((await prepareInstallation(directory,options(),{template})).id,first.id);
  assert.equal(await fs.readFile(path.join(directory,'.env.install'),'utf8'),before);
  await assert.rejects(prepareInstallation(directory,options({port:9082}),{template}),/different settings/);
  await assert.rejects(prepareInstallation(foreign,options(),{template}),/fresh directory/);
  assert.equal(await fs.readFile(path.join(foreign,'keep.txt'),'utf8'),'unrelated');
  if(process.platform!=='win32'){
    assert.equal((await fs.stat(path.join(directory,'installation.json'))).mode&0o777,0o600);
    const link=path.join(root,'link');await fs.symlink(directory,link);await assert.rejects(readInstallation(link),/real directory/);
  }
  await fs.appendFile(path.join(directory,'.env.install'),'CHANGED=yes\n');
  await assert.rejects(readInstallation(directory),/were edited/);
});
test('read-only host checks reject remote, ARM, rootless and obsolete engines without mutation',async()=>{
  const f=dockerFixture();await checkHost({...f,env:{}});
  assert.ok(f.calls.every(args=>['context','info','compose'].includes(args[0])));
  await assert.rejects(checkHost({...dockerFixture(),env:{DOCKER_HOST:'ssh://server.example'}}),/target machine/);
  for(const config of [{arch:'arm64'},{rootless:true}])await assert.rejects(checkHost({...dockerFixture(config),env:{}}),/requires|rootful/);
  const old=dockerFixture();await assert.rejects(checkHost({env:{},execute:async(command,args)=>args[0]==='info'?JSON.stringify({OSType:'linux',Architecture:'amd64',ServerVersion:'25.0.0'}):old.execute(command,args)}),/never upgraded/);
});
test('prepare and check never start or pull; existing settings are reused without upgrade on a start rerun',async t=>{
  const root=await fixture(t),directory=path.join(root,'manager'),f=dockerFixture();
  await main(['--prepare','--directory',directory],{...f,log:()=>{}});assert.equal(f.calls.length,0);
  await main(['--check','--directory',directory],{...f,log:()=>{}});
  assert.ok(!f.calls.some(args=>args.includes('pull')||args.includes('up')||args[0]==='run'));
  const prior=await readInstallation(directory),existing=dockerFixture({containers:'existing-controller'});
  await main(['--start','--directory',directory],{...existing,log:()=>{}});
  assert.equal((await readInstallation(directory)).id,prior.id);
  assert.ok(!existing.calls.some(args=>args.includes('up')||args.includes('pull')||args.includes('stop')||args.includes('restart')));
});
test('fresh start targets only its project, validates image capability and never provisions a game',async t=>{
  const root=await fixture(t),directory=path.join(root,'manager'),manifest=await prepareInstallation(directory,options(),{template}),f=dockerFixture();
  await startInstallation(directory,manifest,{...f,log:()=>{}});
  const compose=f.calls.filter(args=>args[0]==='compose'&&args[1]!=='version');
  assert.ok(compose.every(args=>args[2]===manifest.project));
  assert.ok(f.calls.findIndex(args=>args[0]==='run')<f.calls.findIndex(args=>args.includes('up')));
  assert.ok(!f.calls.some(args=>args.some(value=>['prune','down','stop','restart','create'].includes(value))));
  assert.equal(f.calls.filter(args=>args.includes('up')).length,1);
  const low=dockerFixture({memory:4});await assert.rejects(startInstallation(directory,manifest,{...low,log:()=>{}}),/additional Docker memory/);assert.ok(!low.calls.some(args=>args.includes('up')));
});
test('runtime pull or capability failures never start the manager or change prepared files',async t=>{
  const root=await fixture(t),directory=path.join(root,'manager'),manifest=await prepareInstallation(directory,options(),{template});
  for(const stage of ['pull','run']){
    const f=dockerFixture();await assert.rejects(startInstallation(directory,manifest,{execute:async(command,args)=>{if(args.includes(stage))throw Error('fixture failure');return f.execute(command,args);},log:()=>{}}),/fixture failure/);
    assert.ok(!f.calls.some(args=>args.includes('up')));assert.equal((await readInstallation(directory)).id,manifest.id);
  }
});
test('concurrent starts serialize and a changed configuration cannot be applied after an image pull',async t=>{
  const root=await fixture(t),directory=path.join(root,'manager'),manifest=await prepareInstallation(directory,options(),{template}),f=dockerFixture();
  let resume,entered;const waiting=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>resume=resolve);
  const first=startInstallation(directory,manifest,{execute:async(command,args)=>{if(args[0]==='info'){entered();await gate;}return f.execute(command,args);},log:()=>{}});
  await waiting;
  await assert.rejects(startInstallation(directory,manifest,{...f,log:()=>{}}),/Another installation/);
  resume();await first;
  const changed=dockerFixture();await assert.rejects(startInstallation(directory,manifest,{execute:async(command,args)=>{if(args.includes('pull'))await fs.appendFile(path.join(directory,'.env.install'),'CHANGED=1\n');return changed.execute(command,args);},log:()=>{}}),/were edited/);
  assert.ok(!changed.calls.some(args=>args.includes('up')));
});
test('declared HTTPS origins ignore forged proxy headers and preserve LAN checks',()=>{
  const origin=panelOrigin('https://games.example.com');assert.equal(origin,'https://games.example.com');
  const req={method:'POST',headers:{host:'games.example.com',origin,'x-forwarded-proto':'http'}};
  checkOrigin(req,['games.example.com'],origin);
  assert.throws(()=>checkOrigin({...req,headers:{...req.headers,origin:'http://games.example.com','x-forwarded-proto':'https'}},['games.example.com'],origin),/origin/);
  assert.throws(()=>checkOrigin({...req,headers:{...req.headers,host:'localhost'}},['localhost'],origin),/host/);
  assert.throws(()=>panelOrigin('https://games.example.com/path'),/origin/);
  checkOrigin({method:'POST',headers:{host:'localhost:8082',origin:'http://localhost:8082'}},['localhost']);
});
test('hosted administrator setup consumes its private invitation once and requires explicit onboarding completion',async t=>{
  const root=await fixture(t),origin='https://games.example.com';
  const {link}=await initializePanel(root,origin),token=await fs.readFile(path.join(root,'secrets/controller-token'),'utf8');let ready=false;
  const backend=http.createServer((req,res)=>{assert.equal(req.headers.authorization,'Bearer '+token);res.setHeader('content-type','application/json');if(req.url==='/status')res.end(JSON.stringify({ready}));else if(req.url==='/update-status')res.end('{"busy":false}');else{res.statusCode=404;res.end('{}');}});
  await new Promise(r=>backend.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{backend.closeAllConnections();backend.close(r);}));
  const web=await startFleetWeb({env:{AUTH_DIR:path.join(root,'auth'),CONTROLLER_TOKEN_FILE:path.join(root,'secrets/controller-token'),CONTROLLER_URL:'http://127.0.0.1:'+backend.address().port,PANEL_HOSTS:'games.example.com',PANEL_ORIGIN:origin},port:0,hostname:'127.0.0.1'});
  t.after(()=>new Promise(r=>{web.closeAllConnections();web.close(r);}));
  const target='http://127.0.0.1:'+web.address().port;
  // Preserve the public Host exactly as a real HTTPS reverse proxy does.
  // Fetch deliberately normalizes Host to the loopback URL on recent Node.
  const post=(route,body,session={},override={})=>new Promise((resolve,reject)=>{
    const req=http.request(target+'/api'+route,{method:'POST',headers:{host:'games.example.com',origin,'content-type':'application/json',...session,...override}},res=>{
      let raw='';res.on('data',chunk=>raw+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:new Headers(Object.fromEntries(Object.entries(res.headers).map(([key,value])=>[key,Array.isArray(value)?value.join(', '):value]))),json:async()=>JSON.parse(raw),text:async()=>raw}));
    });req.on('error',reject);req.end(JSON.stringify(body));
  });
  const registration={token:link.split('=')[1],username:'HostOwner',password:'isolated-installation-password'};
  const created=await post('/register',registration);assert.equal(created.status,200,created.status===200?'':await created.text());
  assert.match(created.headers.get('set-cookie'),/; Secure/);assert.match(created.headers.get('strict-transport-security'),/31536000/);
  const account=await created.json();assert.equal(account.role,'admin');assert.equal(account.onboarding.completed,false);
  assert.equal((await post('/register',registration)).status,400);
  const session={cookie:created.headers.get('set-cookie').split(';')[0],'x-csrf-token':account.csrf};
  assert.equal((await post('/onboarding',{complete:true},session)).status,400);
  ready=true;assert.equal((await post('/onboarding',{complete:true},session)).status,200);
  const resumed=await post('/login',{username:registration.username,password:registration.password});assert.equal((await resumed.json()).onboarding.completed,true);
  assert.equal((await post('/login',registration,{}, {origin:'http://games.example.com','x-forwarded-proto':'https'})).status,403);
  const logout=await post('/logout',{},session);assert.match(logout.headers.get('set-cookie'),/Max-Age=0; Secure/);
});
test('welcome explains readiness without requiring a game or exposing unescaped account text',()=>{
  const html=welcomeView({username:'<owner>',origin:'https://games.example.com',status:{ready:false},host:{memoryBudgetGiB:4,dockerMemoryGiB:8}});
  assert.ok(html.includes('&lt;owner&gt;'));assert.ok(!html.includes('<owner>'));
  assert.match(html,/id="finish-installation"[^>]+disabled/);assert.match(html,/create your first server later/);assert.match(html,/HTTPS enabled/);
});
test('Unix Docker bootstrap reuses an installed engine without package or service changes',{skip:process.platform==='win32'},async t=>{
  const root=await fixture(t),bin=path.join(root,'bin');await fs.mkdir(bin);
  const log=path.join(root,'calls');await fs.writeFile(path.join(bin,'docker'),'#!/bin/sh\nprintf "%s\\n" "$*" >> "$INSTALL_FIXTURE_LOG"\n');await fs.chmod(path.join(bin,'docker'),0o755);
  const result=spawnSync('sh',[await sourceFile(sourceRoot,'Install-Docker.sh'),'--install'],{encoding:'utf8',env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,INSTALL_FIXTURE_LOG:log}});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/left unchanged/);assert.equal(await fs.readFile(log,'utf8'),'--version\ncompose version\n');
});
test('fresh Ubuntu bootstrap checks and package installation use only disposable system/command fixtures',{skip:process.platform==='win32'},async t=>{
  const root=await fixture(t),bin=path.join(root,'bin'),etc=path.join(root,'etc'),log=path.join(root,'calls');await fs.mkdir(bin);await fs.mkdir(etc);
  await fs.writeFile(path.join(etc,'os-release'),'ID=ubuntu\nVERSION_ID=24.04\nVERSION_CODENAME=noble\n');
  const script=path.join(root,'Install-Docker.sh');await fs.writeFile(script,(await fs.readFile(await sourceFile(sourceRoot,'Install-Docker.sh'),'utf8')).replaceAll('/etc/',etc+'/'));
  const stubs={uname:'printf "Linux\\n"',dpkg:'printf "amd64\\n"','dpkg-query':'[ "$INSTALL_CONFLICT" != "$3" ] || printf "install ok installed"',id:'printf "0\\n"','apt-get':'printf "apt %s\\n" "$*" >> "$INSTALL_FIXTURE_LOG"',curl:'for item do output=$item; done\nprintf "fixture public key\\n" > "$output"','systemctl':'printf "service %s\\n" "$*" >> "$INSTALL_FIXTURE_LOG"'};
  for(const [name,body] of Object.entries(stubs)){await fs.writeFile(path.join(bin,name),'#!/bin/sh\n'+body+'\n');await fs.chmod(path.join(bin,name),0o755);}
  for(const name of ['install','chmod','cat']){const lookup=spawnSync('sh',['-c','command -v '+name],{encoding:'utf8'}).stdout.trim();await fs.symlink(lookup,path.join(bin,name));}
  const run=arg=>spawnSync('/bin/sh',[script,arg],{encoding:'utf8',env:{PATH:bin,INSTALL_FIXTURE_LOG:log,INSTALL_CONFLICT:''}});
  const check=run('--check');assert.equal(check.status,0,check.stderr);assert.match(check.stdout,/No files or packages changed/);assert.equal(await fs.stat(log).catch(()=>null),null);
  const conflict=spawnSync('/bin/sh',[script,'--install'],{encoding:'utf8',env:{PATH:bin,INSTALL_FIXTURE_LOG:log,INSTALL_CONFLICT:'containerd'}});assert.notEqual(conflict.status,0);assert.match(conflict.stderr,/containerd/);assert.equal(await fs.stat(log).catch(()=>null),null);
  await fs.mkdir(path.join(etc,'apt/sources.list.d'),{recursive:true});
  const installed=run('--install');assert.equal(installed.status,0,installed.stderr);
  assert.match(await fs.readFile(path.join(etc,'apt/sources.list.d/docker.sources'),'utf8'),/URIs: https:\/\/download.docker.com\/linux\/ubuntu/);
  assert.equal(await fs.readFile(log,'utf8'),'apt update\napt install -y ca-certificates curl\napt update\napt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin\nservice enable --now docker\n');
});
test('native launcher prepares a separate installation without requiring Docker',async t=>{
  const root=await fixture(t),directory=path.join(root,'manager'),project=fileURLToPath(new URL('../../',import.meta.url));
  const launcher=process.platform==='win32'?'powershell.exe':'sh';
  const args=process.platform==='win32'?['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(project,'Install.ps1'),'--prepare','--directory',directory]:[path.join(project,'Install.sh'),'--prepare','--directory',directory];
  const result=spawnSync(launcher,args,{encoding:'utf8',env:{...process.env,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH}});
  assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/Nothing started/);assert.equal((await readInstallation(directory)).options.mode,'local');
});
test('Docker-backed Unix launcher keeps checks read-only and refuses destinations outside its mount',{skip:process.platform==='win32'},async t=>{
  const root=await fixture(t),bin=path.join(root,'bin'),log=path.join(root,'calls');await fs.mkdir(bin);
  const stubs={node:'exit 1',docker:'printf "%s\\n" "$*" >> "$INSTALL_FIXTURE_LOG"\ncase "$1" in context) printf "unix:///var/run/docker.sock\\n" ;; info) printf \'linux|x86_64|29.1.0|[]\\n\' ;; compose) printf "2.40.0\\n" ;; esac'};
  for(const [name,body] of Object.entries(stubs)){await fs.writeFile(path.join(bin,name),'#!/bin/sh\n'+body+'\n');await fs.chmod(path.join(bin,name),0o755);}
  const launcher=fileURLToPath(new URL('../../Install.sh',import.meta.url));
  const run=args=>spawnSync('sh',[launcher,...args],{cwd:root,encoding:'utf8',env:{...process.env,DOCKER_HOST:'',DOCKER_CONTEXT:'',PATH:bin+':/usr/bin:/bin',INSTALL_FIXTURE_LOG:log}});
  const checked=run(['--check']);assert.equal(checked.status,0,checked.stderr);assert.match(checked.stdout,/No files changed or containers started/);
  assert.doesNotMatch(await fs.readFile(log,'utf8'),/^run /m);
  const escaped=run(['--prepare','--directory','../outside']);assert.notEqual(escaped.status,0);assert.match(escaped.stderr,/inside your current directory/);assert.doesNotMatch(await fs.readFile(log,'utf8'),/^run /m);
  const valid=run(['--prepare','--directory','./manager']);assert.equal(valid.status,0,valid.stderr);assert.match(await fs.readFile(log,'utf8'),/^run --rm --user 0:0 .*GOBLIN_INSTALL_UID=/m);
  await fs.writeFile(log,'');const unsafeCheck=run(['--install-docker','--check']);assert.notEqual(unsafeCheck.status,0);assert.equal(await fs.readFile(log,'utf8'),'');
});
