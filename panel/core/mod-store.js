import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {assert} from '../common.js';
import {digest} from './mod-downloads.js';

export async function realDirectory(directory,{create=false,mode=0o700}={}){
  const absolute=path.resolve(directory);assert(absolute!=='/','Invalid mod directory.');
  let current=path.parse(absolute).root;
  for(const part of absolute.slice(current.length).split(path.sep)){
    current=path.join(current,part);let stat=await fs.lstat(current).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(!stat&&create){try{await fs.mkdir(current,{mode});await fs.chmod(current,mode);}catch(error){if(error.code!=='EEXIST')throw error;}stat=await fs.lstat(current);}
    if(!stat)return false;
    assert(stat.isDirectory()&&!stat.isSymbolicLink(),'Mod directories cannot contain symbolic links.',409);
  }return true;
}
export const safeModFile=name=>{assert(typeof name==='string'&&name.length<=240&&/^[A-Za-z0-9][A-Za-z0-9_. -]*$/.test(name)&&!name.includes('..'),'Unsafe mod filename.');return name;};
export function createModStore(root,{accept=()=>true}={}){
  async function read(name){
    safeModFile(name);if(!await realDirectory(root))return null;
    const file=path.join(root,name),stat=await fs.lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(!stat)return null;
    assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=64*1024**2,'Mod files must be regular files of at most 64 MiB.',409);
    return {data:await fs.readFile(file),mode:stat.mode&0o777};
  }
  async function list(){
    if(!await realDirectory(root))return new Map();
    const names=(await fs.readdir(root)).filter(accept).sort();assert(names.length<=1000,'Too many installed mod files.',409);
    const files=new Map();let size=0;
    for(const name of names){const entry=await read(name);assert(entry,'Mod files changed. Refresh the library.',409);size+=entry.data.length;assert(size<=256*1024**2,'Installed mods exceed the 256 MiB library review limit.',409);files.set(name,entry);}
    return files;
  }
  async function write(name,data,mode=0o644){
    safeModFile(name);await realDirectory(root,{create:true,mode:0o755});await read(name);
    const file=path.join(root,name);
    if(data===null){await fs.rm(file,{force:true});return;}
    const temporary=path.join(root,'.lg-mod-'+crypto.randomUUID());
    try{await fs.writeFile(temporary,data,{flag:'wx',mode});await fs.chmod(temporary,mode);await fs.rename(temporary,file);}finally{await fs.rm(temporary,{force:true});}
  }
  return {root,read,list,write};
}
export function modRevision(context){return digest(Buffer.from(JSON.stringify({scope:context.scope,version:context.version,items:context.items,files:[...context.files].map(([name,value])=>[name,digest(value.data),value.mode])})));}
