import fs from 'node:fs/promises';

const version=stat=>[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');

// Background save detection needs only three fields, not the full terrain and
// entity payload. Parse once per file change and retain only that small index.
export class SnapshotMetadata {
  constructor(file,{stat=fs.stat,readFile=fs.readFile}={}){
    Object.assign(this,{file,stat,readFile});this.version=null;this.value=null;this.pending=null;
  }
  read(){
    if(!this.pending)this.pending=this.load().finally(()=>{this.pending=null;});
    return this.pending;
  }
  clear(){this.version=null;this.value=null;}
  async load(){
    try{
      const before=version(await this.stat(this.file));
      if(before===this.version)return this.value;
      const snapshot=JSON.parse(await this.readFile(this.file,'utf8'));
      const value=snapshot?{world:snapshot.world,sourceVersion:snapshot.sourceVersion,created:snapshot.created}:null;
      const after=version(await this.stat(this.file));
      // A concurrent atomic replacement is picked up on the next read. Never
      // associate a parsed value with a different version of the file.
      this.value=value;this.version=before===after?after:null;
      return value;
    }catch(error){this.clear();if(error.code==='ENOENT')return null;throw error;}
  }
}
