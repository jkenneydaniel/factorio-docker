import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
import {assert,readJSON,writeJSON,sleep} from '../common.js';import {catalog,validId,labels,resources,validateCreation} from './catalog.js';
import {snapshotImageCompatible} from '../core/game-images.js';
import {ensureOwnedImage} from '../core/image-migration.js';
import {verifySnapshot} from './snapshots.js';
const giB=1024**3;
export class FleetManager{
 constructor({docker,root='/fleet',library='/library',fleet,stateVolume,libraryVolume,image,hostContainer,address='localhost',bind='0.0.0.0',memoryBudgetGiB=16,portBase=35000}){
  assert(validId(fleet),'FLEET_ID must be a fresh 32-character lowercase hex ID.');assert(stateVolume===`lobby-goblin-fleet-${fleet}-state`&&libraryVolume===`lobby-goblin-fleet-${fleet}-library`,'Unexpected host-manager storage names.');
  assert(typeof image==='string'&&image.length>0,'The host manager image is required.');assert(/^[a-zA-Z0-9.-]+$/.test(address)&&['0.0.0.0','127.0.0.1'].includes(bind),'Invalid LAN address or bind setting.');assert(Number.isInteger(Number(memoryBudgetGiB))&&memoryBudgetGiB>=2&&memoryBudgetGiB<=128,'Memory budget must be 2–128 GiB.');assert(Number.isInteger(Number(portBase))&&portBase>=1024&&portBase<=64000,'Port base must be 1024–64000.');
  Object.assign(this,{docker,root,library,fleet,stateVolume,libraryVolume,image,hostContainer,address,bind,memoryBudgetGiB:Number(memoryBudgetGiB),portBase:Number(portBase)});this.active=null;this.settingsUpdating=false;this.queue=Promise.resolve();
 }
 async init(){
  await fs.mkdir(this.root,{recursive:true});await fs.mkdir(this.library,{recursive:true});
  for(const dir of [this.root,this.library]){assert(await fs.realpath(dir)===path.resolve(dir),'Host-manager storage cannot be a link.');const file=path.join(dir,'.fleet-owner.json'),owner=await readJSON(file,null);assert(!owner||owner.fleet===this.fleet,'Host-manager storage belongs to another installation.',409);if(!owner)await writeJSON(file,{fleet:this.fleet});}
  this.state=await readJSON(path.join(this.root,'registry.json'),{version:1,servers:[],snapshots:[],jobs:[]});assert(this.state.version===1,'Unsupported server registry.');
  if(this.state.settings){assert(Number.isInteger(this.state.settings.memoryBudgetGiB)&&this.state.settings.memoryBudgetGiB>=2&&this.state.settings.memoryBudgetGiB<=128&&Number.isSafeInteger(this.state.settings.revision)&&this.state.settings.revision>=0,'Invalid persisted host settings.',409);this.memoryBudgetGiB=this.state.settings.memoryBudgetGiB;}
  for(const job of this.state.jobs)if(job.state==='running'){job.state='interrupted';job.message='Host manager restarted. Resources and data were preserved. Check this server before retrying.';}
  for(const item of this.state.servers)delete item.maintenance;
  await this.persist();
 }
 persist(state=this.state){const data=structuredClone(state);const next=this.queue.then(()=>writeJSON(path.join(this.root,'registry.json'),data));this.queue=next.catch(()=>{});return next;}
 server(id){assert(validId(id),'Invalid server.');const item=this.state.servers.find(s=>s.id===id);assert(item,'Server not found.',404);return item;}
 snapshot(id){assert(validId(id),'Invalid snapshot.');const item=this.state.snapshots.find(s=>s.id===id);assert(item,'Snapshot not found.',404);return item;}
 publicServer(item){const {controllerToken,rconPassword,...publicFields}=item;return {...publicFields,address:`${this.address}:${item.gamePort}`,manageUrl:`/servers/${item.id}/`};}
 list(){return this.state.servers.map(s=>this.publicServer(s));}
 allocations(){return this.state.servers.filter(s=>s.state!=='removed').map(s=>({id:s.id,name:s.name,game:s.game,state:s.state,gameGiB:s.memoryGiB,controllerGiB:1,totalGiB:s.memoryGiB+1}));}
 async hostSettings(){
  const allocations=this.allocations(),allocatedMemoryGiB=allocations.reduce((sum,s)=>sum+s.totalGiB,0);let dockerMemoryGiB=null;
  try{const info=await this.docker('GET','/info');if(Number.isFinite(info.MemTotal)&&info.MemTotal>0)dockerMemoryGiB=info.MemTotal/giB;}catch{}
  return {memoryBudgetGiB:this.memoryBudgetGiB,revision:this.state.settings?.revision??0,allocatedMemoryGiB,availableMemoryGiB:Math.max(0,this.memoryBudgetGiB-allocatedMemoryGiB),dockerMemoryGiB,minMemoryBudgetGiB:Math.max(2,allocatedMemoryGiB),maxMemoryBudgetGiB:dockerMemoryGiB===null?null:Math.min(128,Math.max(0,Math.floor(dockerMemoryGiB)-2)),hostHeadroomGiB:2,allocations,updatedAt:this.state.settings?.updatedAt??null};
 }
 async updateHostSettings(input,actor='administrator'){
  assert(!this.active&&!this.settingsUpdating,'Wait for the current host operation to finish before changing the budget.',409);
  this.settingsUpdating=true;
  try{
   assert(input&&typeof input==='object'&&!Array.isArray(input),'Invalid host settings.');
   assert(Number.isSafeInteger(input.revision)&&input.revision===(this.state.settings?.revision??0),'Host settings changed in another session. Reload the current budget before saving.',409);
   const budget=input.memoryBudgetGiB;assert(Number.isInteger(budget)&&budget>=2&&budget<=128,'Choose a whole-number memory budget from 2 to 128 GiB.');
   const current=await this.hostSettings();assert(current.dockerMemoryGiB!==null,'Docker memory capacity is unavailable. Retry when Docker is ready.',503);
   assert(budget>=current.minMemoryBudgetGiB,`Existing servers and their controllers already have ${current.allocatedMemoryGiB} GiB allocated. The budget cannot be lower than that.`,409);
   assert(budget<=current.maxMemoryBudgetGiB,`Choose at most ${current.maxMemoryBudgetGiB} GiB to leave at least 2 GiB of Docker memory for management and other work.`,409);
   const settings={memoryBudgetGiB:budget,revision:current.revision+1,updatedAt:new Date().toISOString(),updatedBy:actor};
   await this.persist({...this.state,settings});this.state.settings=settings;this.memoryBudgetGiB=budget;
   return {...current,...settings,availableMemoryGiB:budget-current.allocatedMemoryGiB};
  }finally{this.settingsUpdating=false;}
 }
 async assertHost(){const info=await this.docker('GET',`/containers/${encodeURIComponent(this.hostContainer)}/json`);assert(info.Config?.Labels?.['io.lobby-goblin.fleet']===this.fleet&&info.Config.Labels['io.lobby-goblin.role']==='host-controller','The manager does not own its configured host container.',409);this.runtimeImage=info.Image;}
 async ownedContainer(name,id){const info=await this.docker('GET',`/containers/${encodeURIComponent(name)}/json`);assert(info.Config?.Labels?.['io.lobby-goblin.fleet']===this.fleet&&info.Config.Labels['io.lobby-goblin.instance']===id,'Container belongs to another installation.',409);return info;}
 async ownedVolume(name,id){const info=await this.docker('GET',`/volumes/${encodeURIComponent(name)}`);assert(info.Labels?.['io.lobby-goblin.fleet']===this.fleet&&info.Labels['io.lobby-goblin.instance']===id,'Volume belongs to another installation.',409);return info;}
 async ownedNetwork(name,id){const info=await this.docker('GET',`/networks/${encodeURIComponent(name)}`);assert(info.Labels?.['io.lobby-goblin.fleet']===this.fleet&&info.Labels['io.lobby-goblin.instance']===id,'Network belongs to another installation.',409);return info;}
 async reconnect(){
  await this.assertHost();const host=await this.docker('GET',`/containers/${encodeURIComponent(this.hostContainer)}/json`);
  for(const item of this.state.servers.filter(s=>s.state!=='removed')){let network;try{network=await this.ownedNetwork(item.network,item.id);}catch(error){if(error.status===404)continue;throw error;}
   if(!Object.hasOwn(network.Containers||{},host.Id))await this.docker('POST',`/networks/${item.network}/connect`,{Container:this.hostContainer,EndpointConfig:{Aliases:[]}});
  }
 }
 async submit(action,input,actor='administrator'){
  assert(!this.active&&!this.settingsUpdating,'Wait for the current host operation to finish.',409);
  if(action==='create')input=validateCreation(input);
  else if(action==='publish'){const s=this.server(input.serverId);assert(!s.migration||s.migration.state==='complete','Complete the game image migration before publishing snapshots.',409);assert(s.state!=='removed'&&input.confirm===true,'Confirm the save and possible server interruption.');assert(typeof input.title==='string'&&input.title.trim().length>=1&&input.title.length<=80&&!/[\x00-\x1f]/.test(input.title),'Use a snapshot title of 1–80 characters.');input={serverId:s.id,title:input.title.trim(),confirm:true};}
  else if(action==='remove'){const s=this.server(input.serverId);assert(s.state!=='removed'&&input.confirm===true&&input.name===s.name,'Type the server name to remove its containers.');input={serverId:s.id,confirm:true};}
  else assert(false,'Unsupported host operation.');
  const job={id:crypto.randomBytes(16).toString('hex'),action,actor,state:'running',message:'Preparing…',started:new Date().toISOString()};this.active=job;this.state.jobs.unshift(job);this.state.jobs=this.state.jobs.slice(0,100);await this.persist();
  void(async()=>{try{await this.assertHost();const result=await this[action](input,job);Object.assign(job,{state:'succeeded',message:result.message,result});}catch(error){job.state='failed';job.message=error.status?error.message:'The host operation failed. Its server data was preserved; inspect the server logs before retrying.';}finally{job.finished=new Date().toISOString();if(input.serverId)delete this.server(input.serverId).maintenance;this.active=null;await this.persist();}})();return job;
 }
 async stage(job,message){job.message=message;await this.persist();}
 async ensureImage(image,game=Object.values(catalog).find(g=>g.image===image)?.id){return ensureOwnedImage(this.docker,game,image);}
 async allocatePorts(game){
  // Only published-port metadata is used; existing containers are never adopted or changed.
  const containers=await this.docker('GET','/containers/json?all=1');const used=new Set(containers.flatMap(c=>(c.Ports||[]).filter(p=>p.Type==='udp').map(p=>p.PublicPort)).filter(Boolean));
  for(const s of this.state.servers)if(s.state!=='removed')for(const p of [s.gamePort,s.queryPort])if(p)used.add(p);
  for(let port=this.portBase;port<65000;port+=3)if(!used.has(port)&&(game!=='rust'||!used.has(port+2)))return {gamePort:port,...(game==='rust'?{queryPort:port+2}:{})};assert(false,'No free managed game ports remain.',409);
 }
 async helper(item,config,{write=false}={}){
  await this.ownedVolume(item.volume,item.id);const requestId=crypto.randomBytes(16).toString('hex'),directory=path.join(this.root,'requests',requestId);await fs.mkdir(directory,{recursive:true});await writeJSON(path.join(directory,'request.json'),{...config,fleet:this.fleet,id:item.id,game:item.game});
  const name=`lobby-goblin-worker-${requestId}`;let created=false;
  try{await this.docker('POST','/containers/create?'+new URLSearchParams({name}),{Image:this.runtimeImage||this.image,User:'0:0',Entrypoint:['node','/app/fleet/worker.js'],Labels:{...labels(this.fleet,item.id,item.game),'io.lobby-goblin.worker':'true'},HostConfig:{NetworkMode:'none',CapDrop:['ALL'],SecurityOpt:['no-new-privileges:true'],Memory:512*1024**2,NanoCpus:1000000000,Mounts:[{Type:'volume',Source:this.stateVolume,Target:'/setup',VolumeOptions:{Subpath:'requests/'+requestId}},{Type:'volume',Source:item.volume,Target:'/instance',ReadOnly:!write},{Type:'volume',Source:this.libraryVolume,Target:'/library',ReadOnly:config.action!=='snapshot'}]}});created=true;await this.docker('POST',`/containers/${name}/start`);const result=await this.docker('POST',`/containers/${name}/wait?condition=not-running`,undefined,{timeout:1200000});assert(result.StatusCode===0,'The isolated storage operation failed. Check disk space and snapshot compatibility.',409);return await readJSON(path.join(directory,'result.json'),null);
  }finally{if(created){const worker=await this.ownedContainer(name,item.id);if(worker.State?.Running)await this.docker('POST',`/containers/${name}/stop?t=15`);await this.docker('DELETE',`/containers/${name}`);}await fs.rm(directory,{recursive:true,force:true});}
 }
 async create(input,job){
  const info=await this.docker('GET','/info');assert(info.OSType==='linux'&&['x86_64','amd64'].includes(info.Architecture),'This first host-manager version requires Linux containers on an amd64 host.');assert(Number(String(info.ServerVersion).split('.')[0])>=26,'Docker Engine 26 or newer is required for isolated volume subdirectories.');
  const reserved=this.allocations().reduce((n,s)=>n+s.totalGiB,0);assert(reserved+input.memoryGiB+1<=this.memoryBudgetGiB,`This server needs ${input.memoryGiB+1} GiB including its controller, but only ${Math.max(0,this.memoryBudgetGiB-reserved)} GiB remains in the ${this.memoryBudgetGiB} GiB host budget. Open Host settings to review allocations.`,409);assert((reserved+input.memoryGiB+3)*giB<=info.MemTotal,'Keep at least 2 GiB outside the managed server memory budget.',409);
  const game=catalog[input.game];let snapshot=null;if(input.snapshotId){snapshot=this.snapshot(input.snapshotId);assert(snapshot.game===input.game&&snapshotImageCompatible(input.game,snapshot.image,game.image),'This snapshot requires a different game image.',409);const manifest=await verifySnapshot(this.library,snapshot.id,snapshot.manifestSha256);if(input.game==='rust'){assert(Number.isInteger(manifest.seed)&&Number.isInteger(manifest.worldSize),'Rust snapshot is missing its map identity.');input={...input,seed:manifest.seed,worldSize:manifest.worldSize};}}
  const id=crypto.randomBytes(16).toString('hex'),ports=await this.allocatePorts(input.game),item={...input,id,...resources(this.fleet,id,input.game),...ports,seed:input.seed??crypto.randomInt(1,0x100000000),image:game.image,created:new Date().toISOString(),state:'creating',controllerToken:crypto.randomBytes(48).toString('hex'),rconPassword:crypto.randomBytes(48).toString('base64url')};this.state.servers.push(item);await this.persist();
  try{
   await this.stage(job,'Downloading the reviewed game image…');const resolved=await this.ensureImage(game.image);item.image=resolved.reference;await this.persist();
   await this.docker('POST','/volumes/create',{Name:item.volume,Labels:labels(this.fleet,id,input.game)});await this.ownedVolume(item.volume,id);
   await this.stage(job,snapshot?'Verifying and cloning the snapshot…':'Preparing isolated server storage…');await this.helper(item,{action:'provision',name:item.name,image:item.image,seed:item.seed,maxPlayers:item.maxPlayers,controllerToken:item.controllerToken,rconPassword:item.rconPassword,snapshotId:snapshot?.id,snapshotHash:snapshot?.manifestSha256},{write:true});
   await this.docker('POST','/networks/create',{Name:item.network,CheckDuplicate:true,Driver:'bridge',Labels:labels(this.fleet,id,input.game)});await this.ownedNetwork(item.network,id);
   const commonLabels=labels(this.fleet,id,input.game),target=input.game==='rust'?'/steamcmd/rust':'/factorio';
   const environment=input.game==='rust'?{RUST_SERVER_IDENTITY:'lobby-goblin-rust',RUST_RCON_PASSWORD:item.rconPassword,RUST_RCON_PORT:'28016',RUST_SERVER_PORT:'28015',RUST_SERVER_QUERYPORT:'28017',RUST_SERVER_LEVEL:'Procedural Map',RUST_SERVER_WORLDSIZE:String(item.worldSize),RUST_SERVER_SEED:String(item.seed),}:{LOAD_LATEST_SAVE:'true',GENERATE_NEW_SAVE:'false',SAVE_NAME:'world',DLC_SPACE_AGE:'false',UPDATE_MODS_ON_START:'false'};
   const bindings={[game.gamePort+'/udp']:[{HostIp:this.bind,HostPort:String(item.gamePort)}]};if(game.queryPort)bindings[game.queryPort+'/udp']=[{HostIp:this.bind,HostPort:String(item.queryPort)}];
   await this.docker('POST','/containers/create?'+new URLSearchParams({name:item.container,platform:'linux/amd64'}),{Image:item.image,Env:Object.entries(environment).map(([k,v])=>k+'='+v),Labels:commonLabels,ExposedPorts:Object.fromEntries(Object.keys(bindings).map(k=>[k,{}])),HostConfig:{RestartPolicy:{Name:item.autoStart?'unless-stopped':'no'},Memory:item.memoryGiB*giB,NanoCpus:item.cpu*1e9,Mounts:[{Type:'volume',Source:item.volume,Target:target,VolumeOptions:{Subpath:'data',NoCopy:true}}],NetworkMode:item.network,PortBindings:bindings,LogConfig:{Type:'json-file',Config:{'max-size':'10m','max-file':'3'}}},NetworkingConfig:{EndpointsConfig:{[item.network]:{Aliases:[item.container]}}}});
   const env={MODE:'controller',GAME_MODULE:item.game,PORT:'8081',FLEET_ID:this.fleet,FLEET_INSTANCE:id,FLEET_VOLUME:item.volume,FLEET_RESTART_POLICY:item.autoStart?'unless-stopped':'no',CONTROLLER_TOKEN_FILE:'/instance/control/controller-token',STATE_DIR:'/instance/state',UPDATE_STATE_DIR:'/instance/updates',FACTORIO_CONTAINER:item.container,FACTORIO_DATA:'/instance/data',BACKUPS_DIR:'/instance/backups',FACTORIO_PLATFORM:'linux/amd64',GAME_ADDRESS:`${this.address}:${item.gamePort}`,RUST_INSTANCE_ID:id,RUST_CONTAINER:item.container,RUST_IMAGE:item.image,RUST_HOST_DATA:'/managed/'+id,RUST_DATA:'/instance/data/server',RUST_INSTALL_ROOT:'/instance/data',RUST_STATE_DIR:'/instance/state',RUST_BACKUPS_DIR:'/instance/backups',RUST_RCON_PASSWORD_FILE:'/instance/control/rcon-password',RUST_GAME_ADDRESS:`${this.address}:${item.gamePort}`,RELEASE_CHECKS:'false'};
   await this.docker('POST','/containers/create?'+new URLSearchParams({name:item.controller}),{Image:this.runtimeImage||this.image,User:'0:0',Env:Object.entries(env).map(([k,v])=>k+'='+v),Labels:{...commonLabels,'io.lobby-goblin.role':'instance-controller'},HostConfig:{RestartPolicy:{Name:'unless-stopped'},Memory:1024**3,NanoCpus:1e9,CapDrop:['ALL'],CapAdd:['DAC_OVERRIDE'],SecurityOpt:['no-new-privileges:true'],Mounts:[{Type:'volume',Source:item.volume,Target:'/instance'},{Type:'bind',Source:'/var/run/docker.sock',Target:'/var/run/docker.sock'}],NetworkMode:item.network,LogConfig:{Type:'json-file',Config:{'max-size':'5m','max-file':'2'}}},NetworkingConfig:{EndpointsConfig:{[item.network]:{Aliases:[item.controller]}}}});
   await this.docker('POST',`/networks/${item.network}/connect`,{Container:this.hostContainer,EndpointConfig:{Aliases:[]}});
   await this.stage(job,'Starting the new server. Rust may need several minutes to install…');await this.docker('POST',`/containers/${item.container}/start`);await this.docker('POST',`/containers/${item.controller}/start`);item.state='starting';await this.persist();
   for(let n=0;n<60;n++){try{await this.request(item,'/jobs',{action:'start',params:{},actor:job.actor});item.state='installed';await this.persist();return {serverId:id,message:'Server created. Open it for installation progress and game controls.'};}catch(error){if(n===59)throw error;await sleep(1000);}}
  }catch(error){item.state='attention';await this.persist();throw error;}
 }
 async request(item,route,body){
  await this.ownedContainer(item.controller,item.id);const response=await fetch(`http://${item.controller}:8081`+route,{method:body?'POST':'GET',headers:{authorization:'Bearer '+item.controllerToken,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const result=await response.json();assert(response.ok,result.error||'The instance controller is unavailable.',response.status);return result;
 }
 async publish(input,job){
  const item=this.server(input.serverId);item.maintenance='Publishing a snapshot';await this.stage(job,'Saving a consistent snapshot. Rust briefly stops and resumes…');const queued=await this.request(item,'/jobs',{action:'backup',params:{confirm:true},actor:job.actor});let completed;
  for(let n=0;n<1200;n++){const value=await this.request(item,'/jobs');completed=value.jobs.find(j=>j.id===queued.id);if(completed&&!['running','queued'].includes(completed.state)&&!value.active)break;await sleep(1000);}assert(completed?.state==='succeeded','The source backup did not complete. No snapshot was published.',409);
  const name=String(completed.result||'').match(/(?:Backup created: )?([A-Za-z0-9_.-]+\.(?:zip|tar\.gz))$/)?.[1];assert(name,'The source controller did not return a backup name.',409);
  const snapshotId=crypto.randomBytes(16).toString('hex');await this.stage(job,'Copying the completed backup into the shared library…');const result=await this.helper(item,{action:'snapshot',backup:name,snapshotId,name:item.name,title:input.title,image:item.image,seed:item.seed,worldSize:item.worldSize});assert(result?.id===snapshotId,'Snapshot publication did not finish.');
  const manifest=await verifySnapshot(this.library,snapshotId,result.manifestSha256);const entry={id:snapshotId,title:input.title,game:item.game,image:item.image,sourceId:item.id,sourceName:item.name,created:manifest.created,includesPlayerData:manifest.includesPlayerData,...result};this.state.snapshots.push(entry);await this.persist();return {snapshotId,message:'Snapshot published. New servers receive independent copies and fresh credentials.'};
 }
 async remove(input,job){
  const item=this.server(input.serverId);item.maintenance='Removing the server';await this.stage(job,'Saving and stopping the selected server…');
  try{const info=await this.ownedContainer(item.container,item.id);if(info.State.Running){const queued=await this.request(item,'/jobs',{action:'stop',params:{confirm:true},actor:job.actor});for(let n=0;n<180;n++){const jobs=await this.request(item,'/jobs');const result=jobs.jobs.find(j=>j.id===queued.id);if(result&&!['running','queued'].includes(result.state)&&!jobs.active){assert(result.state==='succeeded',result.message,409);break;}await sleep(1000);}const stopped=await this.ownedContainer(item.container,item.id);assert(!stopped.State.Running&&stopped.State.ExitCode===0&&!stopped.State.OOMKilled,'The server did not stop cleanly. No resources were removed.',409);}}
  catch(error){if(error.status!==404)throw error;}
  for(const name of [item.controller,item.container]){let info;try{info=await this.ownedContainer(name,item.id);}catch(error){if(error.status===404)continue;throw error;}if(info.State.Running)await this.docker('POST',`/containers/${name}/stop?t=30`);await this.docker('DELETE',`/containers/${name}`);}
  const filter=encodeURIComponent(JSON.stringify({label:[`io.lobby-goblin.fleet=${this.fleet}`,`io.lobby-goblin.instance=${item.id}`,'io.lobby-goblin.worker=true']}));
  for(const worker of await this.docker('GET','/containers/json?all=1&filters='+filter)){const info=await this.ownedContainer(worker.Id,item.id);assert(info.Config?.Labels?.['io.lobby-goblin.worker']==='true','Resource is not an owned worker.',409);if(info.State.Running)await this.docker('POST',`/containers/${worker.Id}/stop?t=15`);await this.docker('DELETE',`/containers/${worker.Id}`);}
  let network;try{network=await this.ownedNetwork(item.network,item.id);}catch(error){if(error.status!==404)throw error;}
  if(network){const host=await this.docker('GET',`/containers/${this.hostContainer}/json`);const endpoints=Object.keys(network.Containers||{});assert(endpoints.every(id=>id===host.Id),'Another container still uses this server network.',409);if(endpoints.includes(host.Id))await this.docker('POST',`/networks/${item.network}/disconnect`,{Container:this.hostContainer});await this.docker('DELETE',`/networks/${item.network}`);}
  item.state='removed';await this.persist();return {serverId:item.id,retainedVolume:item.volume,message:'Server containers removed. Its isolated data volume and shared snapshots were kept.'};
 }
}
