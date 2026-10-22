import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile),directory=path.dirname(fileURLToPath(import.meta.url));
const root=['../..','../../../..'].map(relative=>path.resolve(directory,relative)).find(candidate=>existsSync(path.join(candidate,'panel/package.json')));
if(!root)throw Error('Run the Rust image builder from a complete checkout or source release.');
const {sourceFile}=await import(pathToFileURL(path.join(root,'panel/source-layout.js')));
export async function imageDefinition(){
 const value=JSON.parse(await fs.readFile(await sourceFile(root,'panel/games/rust/image/image.json'),'utf8'));
 if(value.format!==1||value.platform!=='linux/amd64'||value.repository!=='ghcr.io/jkenneydaniel/rust-server'||!/^steam-lg\.[1-9]\d*$/.test(value.tag)||!/^node:24\.[\d.]+-bookworm-slim@sha256:[a-f0-9]{64}$/.test(value.baseImage)||!/^[a-f0-9]{64}$/.test(value.steamcmdSha256))throw Error('Invalid Rust image definition');
 return {...value,image:value.repository+':'+value.tag};
}
export async function build({run=async args=>execute('docker',args,{timeout:1200000,maxBuffer:8*1024**2})}={}){
 const d=await imageDefinition(),context=await fs.mkdtemp(path.join(os.tmpdir(),'lobby-goblin-rust-build-'));
 try{
  // Never send the checkout's private .env, installed worlds or backups to Docker.
  for(const name of ['panel/package.json','panel/package-lock.json','panel/games/rust/transport.js','panel/games/rust/image/entrypoint.mjs','panel/games/rust/image/Dockerfile']){
   const source=await sourceFile(root,name);if(!(await fs.lstat(source)).isFile()||await fs.realpath(source)!==source)throw Error('Image source must be a regular file without links');
   const target=path.join(context,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(source,target);
  }
  await run(['build','--platform',d.platform,'-f',path.join(context,'panel/games/rust/image/Dockerfile'),'--build-arg','BASE_IMAGE='+d.baseImage,'--build-arg','STEAMCMD_SHA256='+d.steamcmdSha256,'-t',d.image,context]);
  console.log('Built '+d.image);
 }finally{await fs.rm(context,{recursive:true,force:true});}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){if(process.argv[2]==='build')await build();else throw Error('Use build. Native runtime acceptance: panel/test/image-acceptance.mjs rust');}
