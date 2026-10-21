import fs from 'node:fs/promises';
import path from 'node:path';

export async function listFiles(root,depth=3,prefix=''){
  const result=[];let entries;try{entries=await fs.readdir(path.join(root,prefix),{withFileTypes:true});}catch{return result;}
  for(const entry of entries){
    if(entry.isSymbolicLink())continue;
    const relative=path.posix.join(prefix,entry.name);
    if(entry.isDirectory()&&depth>0)result.push(...await listFiles(root,depth-1,relative));
    else if(entry.isFile()){const stat=await fs.stat(path.join(root,relative));result.push({relative,size:stat.size,modified:stat.mtime.toISOString()});}
  }return result;
}
