import {runtimeHelper} from './runtime.js';
import {helperWorkspace,helperWorkspaceMount,removeHelperWorkspace,removeHelperWorker} from '../../core/helper-workspace.js';
import {legacyHelperMount} from './helper-mount.js';
import crypto from 'node:crypto';
import {docker as dockerAPI,demultiplex} from '../../core/docker.js';
import {gameContainerRoute as containerRoute} from './transport.js';
import {assert,redact} from '../../common.js';

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
export function previewKey(configuration,seed,image){return crypto.createHash('sha256').update(JSON.stringify(canonical({terrain:{...configuration.map_gen_settings,seed},image}))).digest('hex');}

// One rendering worker, one latest pending draft per account, small shared cache.
// Preview requests never become world-creation jobs or enter the save library.
export class WorldPreviews{
  constructor({render,canRun=()=>true,now=Date.now,maxPending=8,maxCache=8,ttl=600000}){Object.assign(this,{render,canRun,now,maxPending,maxCache,ttl});this.states=new Map();this.cache=new Map();this.running=null;}
  prune(){const cutoff=this.now()-this.ttl;for(const [id,item] of this.cache)if(item.at<cutoff)this.cache.delete(id);for(const [owner,item] of this.states)if(item.at<cutoff&&item.state!=='rendering')this.states.delete(owner);}
  request(owner,{configuration,seed,image}){
    this.prune();const id=previewKey(configuration,seed,image),old=this.states.get(owner);
    if(old?.id===id&&old.state!=='error'&&(old.state!=='ready'||this.cache.has(id)))return this.status(owner);
    const pending=[...this.states.values()].filter(x=>x.state==='queued').length;
    assert(old?.state==='queued'||pending<this.maxPending,'Several previews are queued. Try again shortly.',429);
    assert(this.states.has(owner)||this.states.size<64,'Too many preview sessions. Try again shortly.',429);
    const state=this.cache.has(id)?'ready':this.running?.owner===owner&&this.running.id===id?'rendering':'queued';
    this.states.set(owner,{id,seed,state,at:this.now(),input:{configuration:structuredClone(configuration),seed,image}});
    void this.tick();return this.status(owner);
  }
  status(owner){this.prune();const item=this.states.get(owner);return item?{id:item.id,seed:item.seed,state:item.state,error:item.error||null}:{state:'idle'};}
  image(owner,id){const item=this.states.get(owner);assert(item?.id===id&&item.state==='ready','Preview is no longer current. Refresh it.',404);const cached=this.cache.get(id);assert(cached,'Preview expired. Refresh it.',404);cached.at=this.now();return cached.png;}
  async waitIdle(){await this.running?.promise;}
  async tick(){
    this.prune();if(this.running||!this.canRun())return;
    const next=[...this.states].find(([,item])=>item.state==='queued');if(!next)return;
    const [owner,item]=next,job={owner,id:item.id};this.running=job;item.state='rendering';
    job.promise=(async()=>{
      try{
        const png=this.cache.get(item.id)?.png||await this.render(item.input);
        assert(Buffer.isBuffer(png)&&png.length>=24&&png.length<=8*1024*1024&&png.subarray(0,8).toString('hex')==='89504e470d0a1a0a','Factorio did not return a valid preview image.');
        this.cache.delete(item.id);this.cache.set(item.id,{png,at:this.now()});while(this.cache.size>this.maxCache)this.cache.delete(this.cache.keys().next().value);
        if(this.states.get(owner)===item)Object.assign(item,{state:'ready',at:this.now()});
      }catch(error){if(this.states.get(owner)===item)Object.assign(item,{state:'error',error:redact(error.message),at:this.now()});}
      finally{this.running=null;}
    })();
    await job.promise;void this.tick();
  }
}

export async function renderWorldPreview({configuration,seed},{data,state,env={},server,docker=dockerAPI,gameContainerRoute=containerRoute}){
  const id=crypto.randomUUID(),helper='factorio-panel-preview-'+id;
  const workspace=await helperWorkspace({data,state,env,server,docker},'preview-'+id);

  let exists=false;
  try{
    await workspace.copyInputs();
    const runtime = await runtimeHelper(workspace,{data,server});
    await workspace.write('config/map-gen.json',JSON.stringify({...configuration.map_gen_settings,seed}));
    // The worker has one CPU: avoid oversubscribing it with Factorio's host-wide default.
    await docker('POST',gameContainerRoute(helper),{Image:server.Image||server.Config.Image,Entrypoint:['/opt/factorio/bin/x64/factorio'],Cmd:['--generate-map-preview','/factorio/preview.png','--map-preview-size','1024','--threads','1','--map-gen-settings','/factorio/config/map-gen.json','--mod-directory','/factorio/mods'],Labels:{'factorio-panel.preview':'true','factorio-panel.preview-id':id},HostConfig:{NetworkMode:'none',Mounts:runtime.mounts,Memory:1073741824,NanoCpus:1000000000}});exists=true;
    await docker('POST','/containers/'+helper+'/start');
    const result=await docker('POST','/containers/'+helper+'/wait?condition=not-running',undefined,{timeout:60000});
    if(result.StatusCode!==0){const logs=demultiplex(await docker('GET','/containers/'+helper+'/logs?stdout=1&stderr=1&tail=8',undefined,{raw:true}));throw new Error('Preview could not be rendered. '+redact(logs).slice(-1200));}
    return await workspace.read('preview.png',8*1024*1024);
  }finally{
    if(exists)await removeHelperWorker(docker,helper);
    await workspace.remove();
  }
}

export async function cleanPreviewWorkers(state,{env={},server,docker=dockerAPI}={}){
  // Reconcile every helper family, including workers left behind after a job
  // reached a terminal state or disappeared from the bounded job history.
  const seen=new Set(),removed=[];
  for(const label of ['factorio-panel.preview=true','factorio-panel.job']){
    const filter=encodeURIComponent(JSON.stringify({label:[label]}));
    for(const worker of await docker('GET','/containers/json?all=1&filters='+filter)){
      if(seen.has(worker.Id))continue;seen.add(worker.Id);
      const preview=worker.Labels?.['factorio-panel.preview']==='true',id=worker.Labels?.[preview?'factorio-panel.preview-id':'factorio-panel.job'];
      if(!/^[0-9a-f-]{36}$/.test(id))continue;
      const names=preview?['factorio-panel-preview-'+id]:['factorio-panel-map-'+id,'factorio-panel-job-'+id];
      const name=names.find(value=>worker.Names?.includes('/'+value));if(!name)continue;
      const info=await docker('GET','/containers/'+encodeURIComponent(name)+'/json');
      assert(info.Id===worker.Id&&info.Config?.Labels?.[preview?'factorio-panel.preview-id':'factorio-panel.job']===id,'Interrupted helper identity changed.',409);
      const child=preview?'preview-'+id:id;
      const current=await helperWorkspaceMount({state,server,env,docker},child),legacy=legacyHelperMount(server,'.panel-work/'+child);
      const mounts=info.HostConfig?.Mounts||[];
      const matches=expected=>(mounts.length===1||mounts.length===2&&mounts[1].ReadOnly===true&&mounts[1].Target==='/opt/factorio'&&mounts[1].Type===expected.Type&&mounts[1].Source===(expected.Type==='volume'?expected.Source:expected.Source+'/engine')&&(mounts[1].VolumeOptions?.Subpath||'')===(expected.Type==='volume'?expected.VolumeOptions.Subpath+'/engine':''))&&mounts[0].Type===expected.Type&&mounts[0].Source===expected.Source&&mounts[0].Target===expected.Target&&(mounts[0].VolumeOptions?.Subpath||'')===(expected.VolumeOptions?.Subpath||'');
      // Standalone hosts can contain several installations using these labels.
      // Their scratch paths must never authorize cleanup in this installation.
      if(!matches(current)&&!matches(legacy)){assert(!env.FLEET_ID,'Interrupted helper storage does not match its installation.',409);continue;}
      await removeHelperWorker(docker,info.Id);
      removed.push(child);
    }
  }
  // Revoke every old mount before touching private scratch paths.
  for(const child of removed)await removeHelperWorkspace(state,child);
}
