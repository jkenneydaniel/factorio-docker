import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createReadStream} from 'node:fs';
import {createGunzip} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import {assert,inside,writeJSON,readJSON} from '../common.js';
import {zipEntries} from '../core/archive.js';
import {validateWorld} from '../games/factorio/world-archive.js';
import {verifyArchive} from '../games/rust/archive.js';
import {snapshotImageCompatible} from '../core/game-images.js';
import {validId} from './catalog.js';
export async function hashFile(file){const hash=crypto.createHash('sha256');for await(const b of createReadStream(file))hash.update(b);return hash.digest('hex');}
const safe=name=>typeof name==='string'&&name.length>0&&!name.includes('\\')&&!name.includes(':')&&!name.startsWith('/')&&!name.split('/').some(p=>['','.','..'].includes(p));
async function inventory(root,relative=''){
 assert((await fs.lstat(root)).isDirectory()&&await fs.realpath(root)===path.resolve(root),'Snapshot root cannot be a link.');
 const files=[];for(const item of await fs.readdir(path.join(root,relative),{withFileTypes:true})){const name=relative?relative+'/'+item.name:item.name;assert(safe(name),'Unsafe snapshot path.');const stat=await fs.lstat(path.join(root,name));assert(!stat.isSymbolicLink(),'Snapshot links are not supported.');if(stat.isDirectory())files.push(...await inventory(root,name));else{assert(stat.isFile(),'Unsupported snapshot file.');files.push({name,size:stat.size,sha256:await hashFile(path.join(root,name))});}}return files.sort((a,b)=>a.name.localeCompare(b.name));
}
// Verify the complete Rust archive before extracting its regular-file-only TAR.
export async function extractRust(file,target){
 await verifyArchive(file);await fs.mkdir(target,{recursive:true});
 const input=createReadStream(file),unzip=createGunzip(),finished=pipeline(input,unzip);void finished.catch(()=>{});const iterator=unzip[Symbol.asyncIterator]();let buffered=Buffer.alloc(0);
 async function take(n){while(buffered.length<n){const next=await iterator.next();assert(!next.done,'Truncated archive.');buffered=Buffer.concat([buffered,next.value]);}const v=buffered.subarray(0,n);buffered=buffered.subarray(n);return v;}
 try{while(true){const block=await take(512);if(block.every(n=>n===0))break;const prefix=block.subarray(345,500).toString().replace(/\0.*$/,''),name=(prefix?prefix+'/':'')+block.subarray(0,100).toString().replace(/\0.*$/,''),size=parseInt(block.subarray(124,136).toString().replace(/\0.*$/,'').trim(),8);assert(safe(name)&&block[156]===48,'Unsafe snapshot archive.');const dest=inside(target,name);await fs.mkdir(path.dirname(dest),{recursive:true});const out=await fs.open(dest,'wx',0o600);try{for(let left=size;left>0;){const b=await take(Math.min(left,65536));left-=b.length;await out.write(b);}}finally{await out.close();}await take((512-size%512)%512);}for await(const chunk of {[Symbol.asyncIterator]:()=>iterator}){}await finished;
 }finally{input.destroy();unzip.destroy();await finished.catch(()=>{});}
}
export async function publishSnapshot({library,source,record,backup}){
 assert(validId(record.id)&&validId(record.sourceId)&&['factorio','rust'].includes(record.game),'Invalid snapshot identity.');
 const temporary=inside(library,'.pending-'+record.id),destination=inside(library,record.id);await fs.mkdir(temporary,{recursive:false});const content=path.join(temporary,'content');await fs.mkdir(content);
 try{
  if(record.game==='factorio'){
   const entries=zipEntries(await fs.readFile(backup));const manifest=JSON.parse(entries.find(e=>e.name==='panel-manifest.json')?.read()||'{}');assert(typeof manifest.activeSave==='string'&&!manifest.activeSave.includes('/')&&!manifest.activeSave.includes('\\'),'Backup has no active world.');const world=entries.find(e=>e.name==='saves/'+manifest.activeSave);assert(world,'Backup has no active world.');const bytes=world.read();validateWorld(bytes);await fs.writeFile(path.join(content,'world.zip'),bytes,{flag:'wx',mode:0o600});
   for(const entry of entries.filter(e=>e.name.startsWith('mods/'))){assert(safe(entry.name),'Unsafe mod path.');const dest=inside(content,entry.name);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,entry.read(),{flag:'wx',mode:0o600});}
  }else{
   assert(!(await verifyArchive(backup)).modded,'Modded Rust backups must be recovered as a complete installation; world-only snapshot cloning would omit framework and plugin state.',409);await extractRust(backup,path.join(temporary,'extracted'));const identity=path.join(temporary,'extracted/identity');await fs.mkdir(path.join(content,'identity'));
   assert((await fs.readdir(identity)).some(name=>name===`proceduralmap.${record.worldSize}.${record.seed}.289.sav`||name.startsWith(`proceduralmap.${record.worldSize}.${record.seed}.`)&&name.endsWith('.sav')),'Rust save does not match the source server seed and size.');
   for(const entry of await fs.readdir(identity)){if(entry==='cfg')continue;assert(safe(entry),'Unsafe identity file.');await fs.cp(path.join(identity,entry),path.join(content,'identity',entry),{recursive:true,dereference:false});}
   await fs.rm(path.join(temporary,'extracted'),{recursive:true});
  }
  const files=await inventory(content);assert(files.length>0&&files.length<=20000,'Snapshot is empty or too large.');
  const manifest={format:'lobby-goblin-snapshot',version:1,...record,created:new Date().toISOString(),files,bytes:files.reduce((n,f)=>n+f.size,0),includesPlayerData:record.game==='rust',credentialsIncluded:false};
  await writeJSON(path.join(temporary,'manifest.json'),manifest);await fs.rename(temporary,destination);return {id:record.id,manifestSha256:await hashFile(path.join(destination,'manifest.json')),files:files.length,bytes:manifest.bytes};
 }finally{await fs.rm(temporary,{recursive:true,force:true});}
}
export async function verifySnapshot(library,id,expectedHash){
 assert(validId(id),'Invalid snapshot.');const root=inside(library,id);assert(await fs.realpath(root)===root,'Snapshot links are not supported.');assert(await hashFile(path.join(root,'manifest.json'))===expectedHash,'Snapshot manifest has changed.',409);
 const manifest=await readJSON(path.join(root,'manifest.json'),null);assert(manifest?.format==='lobby-goblin-snapshot'&&manifest.version===1&&manifest.id===id,'Invalid snapshot manifest.');
 const files=await inventory(path.join(root,'content'));assert(JSON.stringify(files)===JSON.stringify(manifest.files),'Snapshot files no longer match their hashes.',409);return manifest;
}
export async function cloneSnapshot({library,id,hash,data,game,image}){
 const manifest=await verifySnapshot(library,id,hash);assert(manifest.game===game&&snapshotImageCompatible(game,manifest.image,image),'Snapshot game or image is incompatible.',409);const root=path.join(library,id,'content');
 if(game==='factorio'){
  assert(manifest.files.every(f=>f.name==='world.zip'||f.name.startsWith('mods/')),'Unexpected Factorio snapshot file.');const bytes=await fs.readFile(path.join(root,'world.zip'));validateWorld(bytes);await fs.writeFile(path.join(data,'saves/world.zip'),bytes,{flag:'wx'});if(await fs.stat(path.join(root,'mods')).catch(()=>null))await fs.cp(path.join(root,'mods'),path.join(data,'mods'),{recursive:true});
 }else{
  assert(manifest.files.every(f=>f.name.startsWith('identity/')&&!f.name.startsWith('identity/cfg/')),'Unexpected Rust snapshot file.');await fs.cp(path.join(root,'identity'),path.join(data,'server/lobby-goblin-rust'),{recursive:true});
  // Explicitly authorize Steam installation only for this new independent copy.
  // An installed server with a missing binary must never trigger this path.
  await writeJSON(path.join(data,'.lobby-goblin-clone.json'),{game:'rust',identity:'lobby-goblin-rust',snapshot:id});
 }
 return manifest;
}
