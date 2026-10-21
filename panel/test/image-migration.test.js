import test from 'node:test';import assert from 'node:assert/strict';
import {migrateImage,replacementSpec,ensureOwnedImage,assertCleanStop} from '../core/image-migration.js';
import {legacyImage,ownedImages,snapshotImageCompatible} from '../core/game-images.js';
import {fixture} from './image-migration-fixture.js';
test('legacy references are migration-only, exact known versions and immutable Rust input',()=>{
 assert.equal(legacyImage('factorio','factoriotools/factorio:2.0.77'),true);assert.equal(legacyImage('factorio','factoriotools/factorio:2.0.78'),false);assert.equal(legacyImage('rust','didstopia/rust-server:latest'),false);
 assert.equal(snapshotImageCompatible('factorio','factoriotools/factorio:2.0.77',ownedImages.factorio),true);assert.equal(snapshotImageCompatible('factorio','factoriotools/factorio:2.0.76',ownedImages.factorio),false);
 assert.equal(snapshotImageCompatible('rust',ownedImages.rust,ownedImages.factorio),false);
 assert.equal(snapshotImageCompatible('rust',ownedImages.rust+'@sha256:'+'a'.repeat(64),ownedImages.rust),true);
 assert.equal(snapshotImageCompatible('rust',ownedImages.rust+'@sha256:'+'a'.repeat(64),ownedImages.rust+'@sha256:'+'b'.repeat(64)),false);
});
for(const game of ['factorio','rust'])for(const running of [true,false])test(game+' migration preserves resources, storage, environment and '+(running?'running':'stopped')+' state',async()=>{
 const f=fixture(game,{running}),before=structuredClone(f.containers.get('game'));const result=await f.run();assert.equal(result.phase,'complete');const current=f.containers.get('game'),old=f.containers.get('game-pre-lg034');assert.equal(old.State.Running,false);assert.equal(old.HostConfig.RestartPolicy.Name,'no');assert.equal(current.State.Running,running);
 assert.deepEqual(current.HostConfig,{...before.HostConfig,RestartPolicy:{Name:'unless-stopped'}});assert.deepEqual(current.Mounts,before.Mounts);assert.deepEqual(current.Config.NetworkingConfig.EndpointsConfig,{private:{Aliases:['game']}});
 assert.ok(f.calls.findIndex(c=>c.operation==='verified-backup')<f.calls.findIndex(c=>c.url?.includes('/rename')));assert.equal(f.calls.some(c=>c.method==='DELETE'),false);
 assert.equal((await f.run()).phase,'complete');assert.equal(f.calls.filter(c=>c.operation==='verified-backup').length,1);
});
for(const boundary of ['rename','create','persist','ready'])test('migration resumes safely after interruption at '+boundary,async()=>{
 const f=fixture('rust');let once=true;
 if(boundary==='persist')f.options.configured=async()=>{if(once){once=false;throw Error('interrupted');}};
 else if(boundary==='ready')f.options.ready=async()=>{if(once){once=false;throw Error('interrupted');}};
 else f.fail((method,url)=>{if(once&&method==='POST'&&url.includes(boundary==='create'?'/containers/create':'/rename')){once=false;return true;}});
 await assert.rejects(f.run());f.fail(null);assert.equal((await f.run()).phase,'complete');assert.equal(f.calls.filter(c=>c.operation==='verified-backup').length,1);assert.equal(f.containers.size,2);
});
test('failed backup, foreign ownership, modified wrappers and missing image contract cause no replacement',async()=>{
 for(const mode of ['backup','owner','entrypoint','oxide','collision']){
  const f=fixture('rust');if(mode==='backup')f.options.backupStop=async()=>{throw Error('Cannot save');};if(mode==='owner')f.containers.get('game').Config.Labels.owner='foreign';if(mode==='entrypoint')f.containers.get('game').Config.Entrypoint=['custom'];if(mode==='oxide')f.containers.get('game').Config.Env.push('RUST_OXIDE_ENABLED=1');if(mode==='collision')f.containers.set('game-pre-lg034',{Config:{Labels:{owner:'foreign'}}});
  await assert.rejects(f.run());assert.ok(!f.calls.some(c=>c.method==='POST'));assert.equal(f.containers.get('game').State.Running,true);
 }
 await assert.rejects(ensureOwnedImage(async()=>({Architecture:'arm64'}),'rust',ownedImages.rust),/contract/);
});
test('replacement uses image defaults and removes operational endpoint addresses and legacy wrapper flags',()=>{
 const f=fixture('rust'),spec=replacementSpec(f.containers.get('game'),ownedImages.rust,{game:'rust'});assert.equal(spec.Hostname,undefined);assert.equal(spec.Entrypoint,undefined);assert.equal(spec.Cmd,undefined);assert.ok(!spec.Env.includes('RUST_UPDATE_CHECKING=0'));assert.equal(spec.NetworkingConfig.EndpointsConfig.private.IPAddress,undefined);
});
test('Docker omitted/null/empty Cmd fields represent the same default command',async()=>{const f=fixture('factorio');f.containers.get('game').Config.Cmd=null;const request=f.options.docker;f.options.docker=async(...args)=>{const value=await request(...args);if(args[1].includes('/images/sha256%3Aold/'))delete value.Config.Cmd;return value;};assert.equal((await f.run()).phase,'complete');});
test('unpublished images cannot trigger a backup or stop',async()=>{const f=fixture('rust'),request=f.options.docker;f.options.docker=async(...args)=>{const value=await request(...args);if(args[1].startsWith('/images/')&&value.RepoDigests)value.RepoDigests=[];return value;};await assert.rejects(f.run(),/Publish the tested image/);assert.equal(f.calls.some(c=>c.method==='POST'||c.operation==='verified-backup'),false);});
test('standalone retirement removes only the verified old container, never storage, and resumes a failed removal',async()=>{const f=fixture('factorio');f.options.retainOriginal=false;let once=true;f.fail((method,url)=>{if(once&&method==='DELETE'){once=false;return true;}});await assert.rejects(f.run());assert.equal(f.journal.current.phase,'retire');assert.equal(f.containers.get('game').State.Running,true);f.fail(null);assert.equal((await f.run()).phase,'complete');assert.equal(f.containers.has('game-pre-lg034'),false);assert.equal(f.calls.filter(c=>c.method==='DELETE').every(c=>c.url==='/containers/game-pre-lg034'),true);assert.equal(f.journal.current.original.Config.Image,'factoriotools/factorio:2.0.77');});
test('native Factorio SIGTERM status needs current-run save and Goodbye evidence; Rust and crashed games remain refused',async()=>{const info={Id:'test',Config:{Image:'factoriotools/factorio:2.0.77'},State:{Running:false,ExitCode:143,StartedAt:'2026-01-01T00:00:00Z'}};let route;const docker=async(method,url)=>{route=url;return Buffer.from('1.234 Saving finished\n1.235 Goodbye\n');};await assertCleanStop(docker,info,'factorio');assert.match(route,/since=1767225600/);await assert.rejects(assertCleanStop(async()=>Buffer.from('Starting\n'),info,'factorio'));await assert.rejects(assertCleanStop(docker,{...info,State:{...info.State,OOMKilled:true}},'factorio'));await assert.rejects(assertCleanStop(docker,info,'rust'));});
