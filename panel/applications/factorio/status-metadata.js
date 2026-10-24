// Seed and binary version change far less often than player/time telemetry.
// Keep a short, process/world-scoped cache without scripting the active game.
export class StatusMetadata {
  constructor({now=Date.now,ttl=30000}={}){this.now=now;this.ttl=ttl;this.generation=0;this.cached=null;this.pending=null;}
  clear(){this.generation++;this.cached=null;this.pending=null;}
  get(server,world,query){
    const key=JSON.stringify([server.Id,server.Image||server.Config?.Image,server.State?.StartedAt,world]);
    if(this.cached?.key===key&&this.now()-this.cached.at<this.ttl)return Promise.resolve(this.cached.value);
    if(this.pending?.key===key)return this.pending.promise;
    this.cached=null;const generation=++this.generation;
    const promise=(async()=>{
      const seed=await query('/seed'),version=await query('/version'),value={seed,version};
      if(generation===this.generation)this.cached={key,at:this.now(),value};
      return value;
    })().finally(()=>{if(generation===this.generation)this.pending=null;});
    this.pending={key,promise};return promise;
  }
}
