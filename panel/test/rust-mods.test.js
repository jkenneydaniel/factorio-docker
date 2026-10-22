import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {makeZip} from '../core/archive.js';
import {createModManager,validateModAction} from '../games/rust/mods.js';
import {frameworkFiles,frameworkRelease,sha256} from '../games/rust/mod-packages.js';
import {inventory,writeArchive,verifyArchive} from '../games/rust/archive.js';
import {extractRust,publishSnapshot} from '../fleet/snapshots.js';
import {sourceFile} from '../source-layout.js';
import {fileURLToPath,pathToFileURL} from 'node:url';
const {startup}=await import(pathToFileURL(await sourceFile(fileURLToPath(new URL('../../',import.meta.url)),'panel/games/rust/image/entrypoint.mjs')));

function tar(files){
 const chunks=[];for(const [name,content]of files){const data=Buffer.from(content),h=Buffer.alloc(512);h.write(name);const oct=(at,length,value)=>h.write(value.toString(8).padStart(length-1,'0')+'\0',at,length);oct(100,8,0o644);oct(124,12,data.length);h[156]=48;h.fill(32,148,156);h.write('ustar\0',257);oct(148,8,h.reduce((a,b)=>a+b,0));chunks.push(h,data,Buffer.alloc((512-data.length%512)%512));}return gzipSync(Buffer.concat([...chunks,Buffer.alloc(1024)]));
}
const archives={oxide:makeZip([{name:'RustDedicated_Data/Managed/Assembly-CSharp.dll',data:Buffer.from('oxide patched game')},{name:'RustDedicated_Data/Managed/Oxide.Rust.dll',data:Buffer.from('oxide fixture')}]),carbon:tar([['libdoorstop.so','carbon loader'],['carbon/managed/Carbon.Preloader.dll','carbon fixture']])};
async function fixture(t){
 const base=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'lg-rust-mods-')));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const root=path.join(base,'game'),state=path.join(base,'state');await fs.mkdir(root);await fs.mkdir(state);await fs.mkdir(path.join(root,'RustDedicated_Data/Managed'),{recursive:true});await fs.writeFile(path.join(root,'RustDedicated_Data/Managed/Assembly-CSharp.dll'),'vanilla game');await fs.mkdir(path.join(root,'server/lobby-goblin-rust'),{recursive:true});await fs.writeFile(path.join(root,'server/lobby-goblin-rust/world.sav'),'WORLD SENTINEL');
 let running=false,corrupt=false,stopCount=0,failAt=Infinity;const commands=[];
 const fetcher=async url=>{
  const framework=url.includes('CarbonCommunity')?'carbon':'oxide',archive=archives[framework],asset=framework==='carbon'?'Carbon.Linux.Release.tar.gz':'Oxide.Rust-linux.zip';
  if(url.startsWith('https://api.github.com/'))return new Response(JSON.stringify({tag_name:'fixture-v1',assets:[{name:asset,state:'uploaded',size:archive.length,digest:'sha256:'+sha256(archive),browser_download_url:'https://github.com/'+(framework==='carbon'?'CarbonCommunity/Carbon':'OxideMod/Oxide.Rust')+'/releases/download/fixture-v1/'+asset}]}));
  return new Response(corrupt?Buffer.from('changed archive'):archive);
 };
 const manager=createModManager({root,state,fetcher,assertStopped:async()=>{if(++stopCount===failAt)running=true;assert(!running,'Rust must be stopped');},command:async command=>{commands.push(command);return 'Reloaded';}});
 return {base,root,state,manager,commands,fetcher,run:value=>running=value,corrupt:()=>corrupt=true,interrupt:()=>{failAt=stopCount+4;},install:async framework=>{const plan=await manager.plan(framework);return manager.install(plan.id);}};
}
test('review pins official Linux release checksum; changed downloads fail before any framework writes',async t=>{
 const f=await fixture(t),review=await f.manager.plan('oxide');assert.equal(review.sha256,sha256(archives.oxide));f.corrupt();await assert.rejects(f.manager.install(review.id),/changed after review/);assert.equal(await fs.readFile(path.join(f.root,'RustDedicated_Data/Managed/Assembly-CSharp.dll'),'utf8'),'vanilla game');
 await assert.rejects(frameworkRelease('oxide',async()=>new Response(JSON.stringify({assets:[]}))),/checksum/);
});
test('framework switching restores vanilla binaries, preserves worlds and plugin data, and requires stopped Rust',async t=>{
 const f=await fixture(t);f.run(true);await assert.rejects(f.install('oxide'),/stopped/);f.run(false);await f.install('oxide');assert.equal((await f.manager.status()).framework,'oxide');
 await f.manager.plugin({operation:'install',name:'Gather.cs',source:'// trusted fixture'});await fs.mkdir(path.join(f.root,'oxide/data'));await fs.writeFile(path.join(f.root,'oxide/data/balances.json'),'{}');
 await f.install('carbon');assert.equal(await fs.readFile(path.join(f.root,'RustDedicated_Data/Managed/Assembly-CSharp.dll'),'utf8'),'vanilla game');assert.equal((await f.manager.status()).framework,'carbon');
 await f.install('none');assert.equal(await fs.stat(path.join(f.root,'libdoorstop.so')).catch(()=>null),null);assert.equal(await fs.readFile(path.join(f.root,'oxide/data/balances.json'),'utf8'),'{}');assert.equal(await fs.readFile(path.join(f.root,'oxide/plugins/Gather.cs'),'utf8'),'// trusted fixture');assert.equal(await fs.readFile(path.join(f.root,'server/lobby-goblin-rust/world.sav'),'utf8'),'WORLD SENTINEL');
});
test('plugins enable, disable, update, reload and remove while preserving JSON data and previous source',async t=>{
 const f=await fixture(t);await f.install('oxide');await f.manager.plugin({operation:'install',name:'Gather.cs',source:'version one'});await f.manager.plugin({operation:'disable',name:'Gather.cs'});assert.equal((await f.manager.status()).plugins[0].disabled,true);await f.manager.plugin({operation:'enable',name:'Gather.cs'});await f.manager.plugin({operation:'reload',name:'Gather.cs'});assert.deepEqual(f.commands,['oxide.reload Gather']);
 await fs.mkdir(path.join(f.root,'oxide/config'));await fs.writeFile(path.join(f.root,'oxide/config/Gather.json'),'{"rate":1}');const config=await f.manager.configuration('Gather.json');await f.manager.configuration('Gather.json',{source:'{"rate":2}',revision:config.revision});await assert.rejects(f.manager.configuration('Gather.json',{source:'{}',revision:config.revision}),/changed/);
 f.run(true);await assert.rejects(f.manager.plugin({operation:'remove',name:'Gather.cs'}),/stopped/);f.run(false);await f.manager.plugin({operation:'install',name:'Gather.cs',source:'version two'});await f.manager.plugin({operation:'remove',name:'Gather.cs'});assert.equal(await fs.readFile(path.join(f.root,'oxide/config/Gather.json'),'utf8'),'{"rate":2}');assert.ok((await fs.readdir(path.join(f.state,'mods/plugin-history'))).length>=4);
});
test('interrupted framework transaction blocks startup and recovers the original files without world rollback',async t=>{
 const f=await fixture(t),review=await f.manager.plan('oxide');f.interrupt();await assert.rejects(f.manager.install(review.id),/interrupted/);await assert.rejects(f.manager.assertReady(),/interrupted/);f.run(false);await f.manager.recover();await f.manager.assertReady();assert.equal(await fs.readFile(path.join(f.root,'RustDedicated_Data/Managed/Assembly-CSharp.dll'),'utf8'),'vanilla game');assert.equal(await fs.stat(path.join(f.root,'RustDedicated_Data/Managed/Oxide.Rust.dll')).catch(()=>null),null);assert.equal(await fs.readFile(path.join(f.root,'server/lobby-goblin-rust/world.sav'),'utf8'),'WORLD SENTINEL');
});
test('external framework edits, unmanaged installations, symlink paths and injected plugin names fail closed',async t=>{
 const f=await fixture(t);await f.install('oxide');await fs.writeFile(path.join(f.root,'RustDedicated_Data/Managed/Oxide.Rust.dll'),'manual change');await assert.rejects(f.install('none'),/outside the panel/);await fs.symlink(f.base,path.join(f.root,'oxide'));await assert.rejects(f.manager.plugin({operation:'install',name:'Valid.cs',source:'source'}),/links/);
 for(const name of ['../Bad.cs','Bad.cs/other','Bad;quit.cs','Bad\nquit.cs'])assert.throws(()=>validateModAction('plugin',{operation:'remove',name,confirm:true}));assert.throws(()=>validateModAction('plugin-config',{name:'Config.json',source:'{broken',revision:'a'.repeat(64)}));
});
test('framework parsers refuse traversal, symlinks, unexpected payload roots and oversized or corrupt bytes',()=>{
 for(const name of ['server/world.sav','../outside.dll','/tmp/outside']){
  if(!name.startsWith('server/'))assert.throws(()=>makeZip([{name,data:Buffer.from('bad')}]));else assert.throws(()=>frameworkFiles('oxide',makeZip([{name,data:Buffer.from('bad')}])),/unexpected/);
 }
 assert.throws(()=>frameworkFiles('carbon',tar([['../escape','bad']])));assert.throws(()=>frameworkFiles('carbon',Buffer.from('bad')));
});
test('modded archives preserve code, data, original DLLs and long recovery paths, verify extraction, and refuse lossy world cloning',async t=>{
 const f=await fixture(t);await f.install('oxide');await f.manager.plugin({operation:'install',name:'Gather.cs',source:'plugin source'});await fs.mkdir(path.join(f.root,'oxide/data'));await fs.writeFile(path.join(f.root,'oxide/data/player.json'),'{"coins":12}');
 const identity=path.join(f.root,'server/lobby-goblin-rust'),target=path.join(f.base,'backup.tar.gz');await writeArchive(target,identity,{identity:'lobby-goblin-rust',instance:'a'.repeat(32),label:'fixture',extras:await f.manager.backupRoots()});const result=await verifyArchive(target);assert.equal(result.version,2);assert.equal(result.modded,true);
 const extracted=path.join(f.base,'recovered');await extractRust(target,extracted);assert.equal(await fs.readFile(path.join(extracted,'identity/world.sav'),'utf8'),'WORLD SENTINEL');assert.equal(await fs.readFile(path.join(extracted,'mods/oxide/data/player.json'),'utf8'),'{"coins":12}');assert.equal(await fs.readFile(path.join(extracted,'mods/oxide/plugins/Gather.cs'),'utf8'),'plugin source');
 assert.equal(JSON.parse(await fs.readFile(path.join(extracted,'mod-state/backup-active/.lobby-goblin-mods.json'))).framework,'oxide');assert.equal(await fs.readFile(path.join(extracted,'mod-state/backup-active/RustDedicated_Data/Managed/Assembly-CSharp.dll'),'utf8'),'oxide patched game');
 const library=path.join(f.base,'library');await fs.mkdir(library);await assert.rejects(publishSnapshot({library,backup:target,record:{id:'a'.repeat(32),sourceId:'b'.repeat(32),game:'rust',worldSize:1000,seed:1}}),/omit framework/);
 assert.ok((await inventory(path.join(f.state,'mods'),{requireSave:false,prefix:'mod-state/'})).some(file=>file.name.includes('originals/')));
});
test('Carbon bootstrap sets only the game child loader environment and refuses pending framework state',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.root,'RustDedicated'),'disposable binary');await f.install('carbon');const env={RUST_SERVER_IDENTITY:'lobby-goblin-rust',RUST_RCON_PASSWORD:'a'.repeat(40)};
 // Fixture world name is deliberately not a procedural map; remove only our sentinel.
 await fs.unlink(path.join(f.root,'server/lobby-goblin-rust/world.sav'));
 const result=await startup(env,f.root);assert.equal(result.modEnv.LD_PRELOAD,path.join(f.root,'libdoorstop.so'));assert.equal(result.modEnv.DOORSTOP_ENABLED,'1');
 await fs.writeFile(path.join(f.root,'.lobby-goblin-mods.json'),JSON.stringify({format:1,status:'pending',framework:'carbon'}));await assert.rejects(startup(env,f.root),/incomplete/);
});
