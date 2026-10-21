// Read only complete log lines. A save-start alone must never publish a map.
export function completedSave(log){
  let world=null,pending=null,completed=null;
  for(const line of log.slice(0,log.lastIndexOf('\n')+1).split('\n')){
    const loaded=line.match(/Loading map \/factorio\/saves\/([^/\\\r\n]+\.zip):/);
    if(loaded){world=loaded[1];pending=null;completed=null;}
    const named=line.match(/Saving (?:game|map) as \/factorio\/saves\/([^/\\\r\n]+\.zip)\s*$/);
    const autosave=line.match(/Saving to (_autosave\d+) \(/);
    if(named)pending=named[1];else if(autosave)pending=autosave[1]+'.zip';
    if(/Saving finished|Saving progress: 100(?:\.0+)?%?\s*$/.test(line)&&pending){
      completed={world:world||pending,source:pending};pending=null;
    }
  }
  return {completed,saving:pending!==null};
}
export const saveVersion=(world,source,stat)=>JSON.stringify([world,source,stat.size,stat.mtimeMs]);

// There is one pending slot: newer saves replace it while a worker is busy.
// Keep that slot in persistent state until the corresponding export succeeds.
export class SaveMapQueue {
  constructor(saved={}, {debounceMs=2000,retryMs=60000}={}){
    this.pending=saved.pending||null;this.due=saved.due||0;this.lastError=saved.lastError||null;
    this.running=null;this.debounceMs=debounceMs;this.retryMs=retryMs;
  }
  observe(candidate,snapshot,now=Date.now()){
    if(!candidate)return;
    if(snapshot?.sourceVersion===candidate.version&&snapshot.world===candidate.world){
      if(this.pending?.version===candidate.version)this.pending=null;
      return;
    }
    if(this.pending?.version!==candidate.version){this.pending=candidate;this.due=now+this.debounceMs;}
  }
  claim(busy,now=Date.now()){
    if(busy||this.running||!this.pending||now<this.due)return null;
    this.running=this.pending.version;return {...this.pending};
  }
  finish(task,ok,error=null,now=Date.now()){
    this.running=null;
    if(ok){this.lastError=null;if(this.pending?.version===task.version)this.pending=null;}
    else{this.lastError=error||'Automatic map refresh failed.';if(this.pending?.version===task.version)this.due=now+this.retryMs;}
  }
  toJSON(){return {pending:this.pending,due:this.due,lastError:this.lastError};}
  status(){return {enabled:true,pending:!!this.pending,running:!!this.running,lastError:this.lastError};}
}
