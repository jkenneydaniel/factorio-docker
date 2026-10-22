import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {sourceSnapshot,unpackRelease} from '../update-source.js';
import {legacySlug} from '../branding.js';
import {unpackRelease as unpack020} from './fixtures/updater-v0.2.0-alpha.mjs';
import {unpackRelease as unpack033} from './fixtures/updater-v0.3.3-alpha.mjs';
import {verifyImageContents} from './installer-image-smoke.js';

const run=promisify(execFile),project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');

test('compatible release bundles contain an importable core/module runtime and preserve prepare-only setup',{timeout:20000},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'factory-module-release-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source=path.join(root,'source');await fs.mkdir(source);
  // Only the existing public-source allowlist is read/copied, never data, auth,
  // backups, local .env files, diagnostics or the running installation.
  for(const name of Object.keys(await sourceSnapshot(project))){const target=path.join(source,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(project,name),target);}
  await run(process.execPath,['tools/release.mjs'],{cwd:source,timeout:10000});
  const {version}=JSON.parse(await fs.readFile(path.join(source,'panel/package.json'),'utf8'));
  const prefix=path.join(source,'dist/lobby-goblin-'+version);
  const historicalZip=path.join(source,'dist/'+legacySlug+'-'+version);
  const historicalArchive=await fs.readFile(historicalZip+'.zip');
  const historicalChecksum=await fs.readFile(historicalZip+'.sha256','utf8');
  const historicalMetadata=JSON.parse(await fs.readFile(historicalZip+'.update.json','utf8'));
  for(const unpack of [unpack020,unpack033]){
    const accepted=unpack(historicalArchive,historicalChecksum,version,historicalMetadata);
    assert.ok(accepted.has('Setup.sh'));
    assert.ok(accepted.has('panel/source-layout.js'));
    assert.ok(![...accepted.keys()].some(name=>/^(images|scripts|deploy)\//.test(name)));
  }
  for(const suffix of ['','.source']){
    const historical=path.join(source,'dist/'+legacySlug+'-'+version);
    const files=unpackRelease(await fs.readFile(historical+suffix+'.zip'),await fs.readFile(historical+suffix+'.sha256','utf8'),version,JSON.parse(await fs.readFile(historical+suffix+'.update.json','utf8')));
    assert.equal(files.get('panel/branding.js').toString(),await fs.readFile(path.join(source,'panel/branding.js'),'utf8'));
  }
  for(const suffix of ['','.source']){
    const files=unpackRelease(await fs.readFile(prefix+suffix+'.zip'),await fs.readFile(prefix+suffix+'.sha256','utf8'),version,JSON.parse(await fs.readFile(prefix+suffix+'.update.json','utf8')));
    assert.ok(files.has('panel/package-lock.json'),'Release must include the locked Rust WebSocket dependency');
    for(const name of ['panel/core/image-migration.js','panel/core/standalone-migration.js','panel/fleet/migrations.js','panel/games/rust/image/Dockerfile','panel/games/rust/image/entrypoint.mjs','panel/games/rust/image/image.json'])assert.ok(files.has(name),'Missing migration or image source: '+name);
    for(const name of ['panel/fleet/manager.js','panel/fleet/controller.js','panel/fleet/web.js','panel/fleet/worker.js','panel/core/data-mount.js','panel/public/scope.js','panel/public/fleet/app.js','panel/core/controller.js','panel/core/web.js','panel/core/accounts.js','panel/games/index.js','panel/games/factorio/controller.js','panel/games/factorio/setup.js','panel/games/factorio/update-worker.js','panel/games/rust/controller.js','panel/games/rust/archive.js','panel/games/rust/compose.yaml','panel/games/rust/setup.js','panel/public/rust/app.js'])assert.ok(files.has(name),'Missing module source in '+suffix+' bundle: '+name);
    assert.ok(![...files.keys()].some(name=>/^(data|backups|\.panel-data)\//.test(name)));
    for(const [name,data] of files){
      if(!name.endsWith('.md'))continue;
      for(const match of data.toString().matchAll(/\]\(([^\s)#]+)[^)]*\)/g)){
        const link=match[1];if(/^(?:[a-z]+:|\/)/i.test(link))continue;
        const target=path.posix.normalize(path.posix.join(path.posix.dirname(name),decodeURIComponent(link)));
        assert.ok(files.has(target),'Broken release documentation link: '+name+' -> '+link);
      }
    }
    const freshRoots=['fleet.compose.yaml','.env.fleet.example','Fleet.ps1','Fleet.sh','Install.sh','Install.command','Install.ps1','Install-Docker.sh'];
    if(suffix){
      for(const name of freshRoots)assert.ok(files.has(name),'Missing host manager launcher '+name);
      for(const name of ['panel/install.js','docs/INSTALLATION.md','factorio-image/Dockerfile','factorio-image/test-build.mjs','panel/games/rust/image/build.mjs'])assert.ok(files.has(name),'Missing complete source '+name);
      assert.ok(![...files.keys()].some(name=>/^(images|scripts|deploy)\//.test(name)));
      const complete=path.join(root,'complete');await fs.mkdir(complete);
      for(const [name,data] of files){const target=path.join(complete,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,data);}
      await run(process.execPath,['--test','factorio-image/test-build.mjs','panel/games/rust/image/test-runtime.test.mjs','panel/test/host-setup.test.js','panel/test/installation.test.js'],{cwd:complete,timeout:15000});
      // Repack an extracted source bundle without changing its installed paths.
      await run(process.execPath,['tools/release.mjs'],{cwd:complete,timeout:10000});
      continue;
    }
    for(const name of freshRoots)assert.ok(!files.has(name),'Historical updater must not receive new root files');
    const install=path.join(root,'install');await fs.mkdir(install);
    for(const [name,data] of files){const target=path.join(install,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,data);}
    // Model the checkout build context, rather than the compatibility archive:
    // independent image sources are packaged at old paths but do not ship in
    // the shared runtime. No Docker engine or image operations are used here.
    const image=path.join(root,'image');await fs.mkdir(image);
    const dockerfile=await fs.readFile(path.join(install,'panel/Dockerfile'),'utf8');
    for(const line of dockerfile.split('\n')){
      if(!line.startsWith('COPY --chown=node:node '))continue;
      const names=line.slice('COPY --chown=node:node '.length).trim().split(/\s+/),dest=names.pop();
      for(const name of names){
        if(name.startsWith('*.')){
          for(const file of await fs.readdir(path.join(source,'panel')))if(file.endsWith(name.slice(1)))await fs.copyFile(path.join(source,'panel',file),path.join(image,file));
        }else await fs.cp(path.join(source,'panel',name),path.join(image,dest),{recursive:true});
      }
    }
    await run(process.execPath,['--input-type=module','-e',"import {selectedGame} from './games/index.js'; import {startController} from './core/controller.js'; import {startWeb} from './core/web.js'; import './setup.js'; import './update-worker.js'; import './games/rust/setup.js'; if(selectedGame().id!=='factorio'||selectedGame('rust').id!=='rust'||typeof startController!=='function'||typeof startWeb!=='function')throw Error('Incomplete runtime');"],{cwd:image,timeout:5000});
    // Exercise the same image/package comparison used by CI, including its
    // historical Rust image sources and rejection of changed runtime bytes.
    if(await fs.stat(path.join(source,'images/rust')).catch(()=>null))assert.equal(await fs.stat(path.join(image,'games/rust/image')).catch(()=>null),null);
    await verifyImageContents(files,image);
    const runtimeFile=path.join(image,'games/rust/controller.js'),original=await fs.readFile(runtimeFile);
    await fs.appendFile(runtimeFile,'\n// changed runtime fixture\n');
    await assert.rejects(verifyImageContents(files,image),/Image\/package mismatch/);
    await fs.writeFile(runtimeFile,original);
    // Exercise the exported setup function; the CLI prerequisite checks need
    // Docker, so no CLI, engine, socket or game process is used here.
    const prepare="import fs from 'node:fs/promises'; import {setup} from './setup.js'; const root=process.argv[1]; await setup(root,['--new-world'],{log:()=>{}}); const files=['.panel-data/auth/users.json','.panel-data/secrets/controller-token','.panel-data/registration-link.txt','data/config/server-settings.json']; const before=await Promise.all(files.map(f=>fs.readFile(root+'/'+f,'utf8'))); await setup(root,['--new-world'],{log:()=>{}}); const after=await Promise.all(files.map(f=>fs.readFile(root+'/'+f,'utf8'))); if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Setup changed existing state'); if((await fs.readdir(root+'/data/saves')).length)throw Error('Prepare-only setup created a world');";
    await run(process.execPath,['--input-type=module','-e',prepare,install],{cwd:image,timeout:5000});
  }
});
