import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sourceFile,repositoryPath} from '../source-layout.js';

const root=new URL('../../',import.meta.url),windows=process.platform==='win32';
// The launcher sees only this simulated executable, never a real Docker daemon.
async function fixture(t,{organized=false}={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fc-host-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  for(const file of ['Setup.sh','Setup.ps1','.env.example']){
    const target=path.join(dir,organized?repositoryPath(file):file);
    await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.copyFile(await sourceFile(fileURLToPath(root),file),target);
  }
  if(organized){await fs.mkdir(path.join(dir,'panel'));await fs.writeFile(path.join(dir,'panel/package.json'),'{}');await fs.writeFile(path.join(dir,'compose.yaml'),'fixture');}
  const launcher=name=>path.join(dir,organized?repositoryPath(name):name);
  const bin=path.join(dir,'bin');await fs.mkdir(bin);
  const mock=path.join(bin,'docker.mjs');
  await fs.writeFile(mock,`#!/usr/bin/env node
import fs from 'node:fs';
const args=process.argv.slice(2);fs.appendFileSync(process.env.HOST_SETUP_LOG,JSON.stringify(args)+'\\n');
if(args[0]==='info')console.log(process.env.HOST_SETUP_INFO||'linux|aarch64|Docker Desktop|[]');
if(args[0]==='context')console.log(process.env.HOST_SETUP_ENDPOINT||'unix:///var/run/docker.sock');
if(args.includes('run')&&process.env.HOST_SETUP_FAIL==='1')process.exit(1);
`);
  await fs.chmod(mock,0o755);
  if(!windows)await fs.symlink(mock,path.join(bin,'docker'));
  const log=path.join(dir,'calls.jsonl');
  return {dir,async run(args=[],extra={}){
    const env={...process.env,PATH:bin+path.delimiter+process.env.PATH,HOST_SETUP_LOG:log,...extra};
    // A caller's selected Docker context/host must not leak into a fixture.
    delete env.DOCKER_HOST;delete env.DOCKER_CONTEXT;
    let command='sh',params=[launcher('Setup.sh'),...args];
    if(windows){
      const mapped={'--check':'-Check','--new-world':'-NewWorld','--save':'-Save','--registration-link':'-RegistrationLink','--start':'-Start','--address':'-Address','--help':'-Help'};
      const quote=value=>"'"+value.replaceAll("'","''")+"'";
      const invocation=args.map(arg=>mapped[arg]||quote(arg)).join(' ');
      const wrapper=path.join(dir,'invoke.ps1');
      await fs.writeFile(wrapper,`$ErrorActionPreference = 'Stop'\nfunction global:docker { & ${quote(process.execPath)} ${quote(mock)} @args; $global:LASTEXITCODE = $LASTEXITCODE }\n& ${quote(launcher('Setup.ps1'))} ${invocation}\n`);
      command='powershell.exe';params=['-NoProfile','-ExecutionPolicy','Bypass','-File',wrapper];
    }
    const result=spawnSync(command,params,{env,encoding:'utf8'});
    const calls=(await fs.readFile(log,'utf8').catch(()=>'' )).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
    return {...result,calls,output:result.stdout+result.stderr};
  }};
}
test('host check is read-only on ARM and never creates a container',async t=>{
  const f=await fixture(t),r=await f.run(['--check']);
  assert.equal(r.status,0,r.output);assert.match(r.output,/emulation/);
  assert.equal(await fs.stat(path.join(f.dir,'.env')).catch(()=>null),null);
  assert.ok(!r.calls.some(args=>args.includes('run')||args.includes('up')));
});
test('relocated standalone launcher prepares repository-root state even when invoked from elsewhere',async t=>{
  const f=await fixture(t,{organized:true});
  const r=await f.run(['--new-world','--address','organized.example']);
  assert.equal(r.status,0,r.output);
  assert.match(await fs.readFile(path.join(f.dir,'.env'),'utf8'),/^SERVER_ADDRESS=organized\.example$/m);
  assert.equal(await fs.stat(path.join(f.dir,'scripts/standalone/.env')).catch(()=>null),null);
  assert.ok(r.calls.some(args=>args.includes('run')&&args.includes('--new-world')));
  assert.ok(!r.calls.some(args=>args.includes('up')));
});
test('native Linux setup discovers the socket group without using Desktop defaults',{skip:windows},async t=>{
  const f=await fixture(t),stat=path.join(f.dir,'bin/stat');
  await fs.writeFile(stat,'#!/bin/sh\nprintf "987\\n"\n');await fs.chmod(stat,0o755);
  const r=await f.run(['--new-world'],{HOST_SETUP_INFO:'linux|aarch64|Debian GNU/Linux|[]'});
  assert.equal(r.status,0,r.output);
  assert.match(await fs.readFile(path.join(f.dir,'.env'),'utf8'),/^DOCKER_SOCKET_GID=987$/m);
  assert.match(r.output,/binfmt\/QEMU/);
});
test('new installation prepares only, preserves custom ports and setup reruns preserve configuration',async t=>{
  const f=await fixture(t);
  const env=(await fs.readFile(path.join(f.dir,'.env.example'),'utf8')).replace('PANEL_PORT=8080','PANEL_PORT=9080');
  await fs.writeFile(path.join(f.dir,'.env'),env);
  const r=await f.run(['--new-world','--address','factory.example']);assert.equal(r.status,0,r.output);
  assert.match(r.output,/http:\/\/factory.example:9080/);
  assert.ok(r.calls.some(args=>args.includes('run')&&args.includes('--new-world')));
  assert.ok(!r.calls.some(args=>args.includes('up')));
  const before=await fs.readFile(path.join(f.dir,'.env'),'utf8');
  assert.equal((await f.run(['--new-world'])).status,0);
  assert.equal(await fs.readFile(path.join(f.dir,'.env'),'utf8'),before);
});
test('import preserves spaced path as one argument and start is explicit',async t=>{
  const f=await fixture(t);await fs.mkdir(path.join(f.dir,'import'));await fs.writeFile(path.join(f.dir,'import/Our factory.zip'),'fixture');
  const r=await f.run(['--save','import/Our factory.zip','--start']);assert.equal(r.status,0,r.output);
  assert.ok(r.calls.some(args=>args.includes('/workspace/import/Our factory.zip')));
  assert.ok(r.calls.some(args=>args.join(' ')==='compose up -d --no-build'));
});
test('setup failure prevents requested start; remote and rootless daemons fail before writing',async t=>{
  for(const extra of [{HOST_SETUP_FAIL:'1'},{HOST_SETUP_ENDPOINT:'ssh://remote.example'},{HOST_SETUP_INFO:'linux|aarch64|Linux|["name=rootless"]'}]){
    const f=await fixture(t),r=await f.run(['--new-world','--start'],extra);
    assert.notEqual(r.status,0,r.output);assert.ok(!r.calls.some(args=>args.includes('up')));
    if(!extra.HOST_SETUP_FAIL)assert.equal(await fs.stat(path.join(f.dir,'.env')).catch(()=>null),null);
  }
});
test('invalid choices, addresses, and traversal imports fail without preparing data',async t=>{
  for(const args of [['--check','--start'],['--new-world','--registration-link'],['--new-world','--address','https://bad.example'],['--save','import/../private.zip']]){
    const f=await fixture(t),r=await f.run(args);assert.notEqual(r.status,0,r.output);assert.ok(!r.calls.some(args=>args.includes('run')));
  }
});
