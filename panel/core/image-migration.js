import {assert} from '../common.js';
import {ownedImage,migrationImage} from './game-images.js';
import {demultiplex} from './docker.js';
const route=name=>'/containers/'+encodeURIComponent(name);
export async function assertCleanStop(docker,info,game){
 const state=info.State||{};assert(!state.Running&&!state.OOMKilled&&!state.Error,'Migration requires a cleanly stopped game.',409);
 if(state.ExitCode===0)return;
 // Native Factorio can preserve SIGTERM's 128+15 status after saving. Do not
 // accept that status without this start's own save-complete/shutdown records.
 const started=Date.parse(state.StartedAt);
 assert(game==='factorio'&&state.ExitCode===143&&Number.isFinite(started)&&(migrationImage(game,info.Config.Image)||ownedImage(game,info.Config.Image)),'Migration requires a cleanly stopped game.',409);
 const logs=demultiplex(await docker('GET',route(info.Id)+'/logs?'+new URLSearchParams({stdout:'1',stderr:'1',tail:'250',since:String(Math.floor(started/1000))}),undefined,{raw:true}));
 assert((/^\s*\d+(?:\.\d+)?\s+Saving finished\b/m.test(logs)||/^\s*\d+(?:\.\d+)?\s+Info MainLoop\.cpp:\d+: Saving progress: 100\.0+%\s*$/m.test(logs))&&/^\s*\d+(?:\.\d+)?\s+Goodbye\.?\s*$/m.test(logs),'Factorio shutdown did not confirm save completion and Goodbye.',409);
}
export async function ensureOwnedImage(docker,game,reference){
 assert(ownedImage(game,reference),'Migration target must be a Lobby Goblin image.',409);
 let image;try{image=await docker('GET','/images/'+encodeURIComponent(reference)+'/json');}catch(error){if(error.status!==404)throw error;
  const at=reference.indexOf('@'),tag=reference.lastIndexOf(':');const fromImage=at>=0?reference.slice(0,at):reference.slice(0,tag),value=at>=0?reference.slice(at+1):reference.slice(tag+1);
  const output=await docker('POST','/images/create?'+new URLSearchParams({fromImage,tag:value,platform:'linux/amd64'}),undefined,{raw:true,timeout:1200000});
  for(const line of output.toString().split('\n').filter(Boolean))assert(!JSON.parse(line).error,'The migration image could not be downloaded. Existing containers were preserved.',502);
  image=await docker('GET','/images/'+encodeURIComponent(reference)+'/json');
 }
 const labels=image.Config?.Labels||{};
 assert(image.Architecture==='amd64'&&image.Os==='linux'&&labels['io.lobby-goblin.compatibility']==='1'&&(game!=='rust'||labels['io.lobby-goblin.game']==='rust'),'The image does not satisfy the Lobby Goblin game contract.',409);
 assert(game!=='factorio'||labels['factorio.version']==='2.0.77','Factorio migration must preserve version 2.0.77.',409);
 const revision=reference.split('@')[0].match(/(?:-fc\.|steam-lg\.)([1-9]\d*)$/)?.[1];assert(labels['io.lobby-goblin.image-revision']===revision,'The image revision does not match its contract.',409);
 assert(/^sha256:[a-f0-9]{64}$/.test(image.Id),'The image has no immutable identity.',409);
 const repository=reference.split('@')[0].slice(0,reference.split('@')[0].lastIndexOf(':'));
 const digest=image.RepoDigests?.find(value=>value.startsWith(repository+'@sha256:'));
 assert(digest,'Publish the tested image before migrating installations.',409);
 const resolved=reference.split('@')[0]+'@'+digest.split('@')[1];assert(!reference.includes('@')||resolved===reference,'The migration image digest changed.',409);
 return {image,reference:resolved};
}
export function replacementSpec(info,image,{game,env={}}={}){
 // Inspect includes operational endpoint data; only explicit create fields recur.
 const config=structuredClone(info.Config),host=structuredClone(info.HostConfig);
 for(const key of ['Hostname','Domainname','Image','Entrypoint','Cmd','WorkingDir','User','Healthcheck','OnBuild','ArgsEscaped','Shell'])delete config[key];
 if(game){
  config.Env=(config.Env||[]).filter(line=>game==='rust'?/^RUST_(SERVER_(IDENTITY|PORT|QUERYPORT|LEVEL|WORLDSIZE|SEED)|RCON_(PASSWORD|PORT))=/.test(line):/^(LOAD_LATEST_SAVE|GENERATE_NEW_SAVE|SAVE_NAME|DLC_SPACE_AGE|UPDATE_MODS_ON_START|PUID|PGID|PORT|RCON_PORT|PRESET|SAVES|CONFIG|MODS|SCENARIOS|SCRIPTOUTPUT|USE_SERVER_WHITELIST|BIND|CONSOLE_LOG_LOCATION)=/.test(line));
 }else{Object.assign(config,{Entrypoint:info.Config.Entrypoint,Cmd:info.Config.Cmd,WorkingDir:info.Config.WorkingDir,User:info.Config.User});}
 const overrides=new Map(Object.entries(env));config.Env=(config.Env||[]).filter(line=>!overrides.has(line.split('=')[0])).concat([...overrides].map(([k,v])=>k+'='+v));
 const endpoints={};for(const [network,value] of Object.entries(info.NetworkSettings?.Networks||{}))endpoints[network]={Aliases:(value.Aliases||[]).filter(alias=>alias!==info.Id&&alias!==info.Id?.slice(0,12)),...(value.IPAMConfig?{IPAMConfig:value.IPAMConfig}:{})};
 return {...config,Image:image,HostConfig:host,NetworkingConfig:{EndpointsConfig:endpoints}};
}
// Caller owns the operation lock and validates exact installation mounts/labels.
// The journal records intent BEFORE each mutation, including rename/create.
// The old container is retained stopped, with restarts disabled, for recovery.
export async function migrateImage({docker,name,game,target,journal,save,owned,backupStop,configured,ready,retainOriginal=true,resolveImage=ensureOwnedImage}){
 const retain=name+'-pre-lg034';let state=journal;
 if(!state){
  const original=await docker('GET',route(name)+'/json');await owned(original);
  if(ownedImage(game,original.Config.Image)&&!migrationImage(game,original.Config.Image))return {unchanged:true};
  assert(migrationImage(game,original.Config.Image),'Unsupported legacy image. A reviewed migration is required.',409);
  const previousImage=await docker('GET','/images/'+encodeURIComponent(original.Image)+'/json');
  // Docker inspect may omit an empty image Cmd while container inspect emits null.
  assert(JSON.stringify(original.Config.Entrypoint??[])===JSON.stringify(previousImage.Config.Entrypoint??[])&&JSON.stringify(original.Config.Cmd??[])===JSON.stringify(previousImage.Config.Cmd??[]),'Custom entrypoints require a reviewed migration.',409);
  const values=Object.fromEntries((original.Config.Env||[]).map(line=>{const p=line.indexOf('=');return [line.slice(0,p),line.slice(p+1)];}));
  assert(game!=='rust'||!['1','true'].includes(values.RUST_OXIDE_ENABLED),'Modified Rust servers require a reviewed migration.',409);
  assert(game!=='rust'||!values.RUST_SERVER_STARTUP_ARGUMENTS||values.RUST_SERVER_STARTUP_ARGUMENTS==='-batchmode -nographics +server.secure 1 -logfile -','Custom Rust arguments require a reviewed migration.',409);
  assert(game!=='rust'||['RUST_SERVER_NAME','RUST_SERVER_DESCRIPTION','RUST_SERVER_MAXPLAYERS','RUST_SERVER_SAVE_INTERVAL'].every(key=>!values[key]),'Move Rust command-line settings to server.cfg before a reviewed migration.',409);
  assert(game!=='rust'||!values.RUST_SERVER_LEVEL||values.RUST_SERVER_LEVEL==='Procedural Map','Custom maps require a reviewed migration.',409);
  assert(game!=='rust'||!values.RUST_SERVER_LEVELURL,'Custom map URLs require a reviewed migration.',409);
  assert(game!=='rust'||(!values.RUST_SERVER_URL||values.RUST_SERVER_URL==='https://hub.docker.com/r/didstopia/rust-server/')&&!values.RUST_SERVER_BANNER_URL&&(!values.RUST_APP_PORT||values.RUST_APP_PORT==='28082'),'Custom Rust companion or presentation options require a reviewed migration.',409);
  assert(game!=='factorio'||!['true','1'].includes(values.UPDATE_MODS_ON_START),'Automatic mod downloads require a reviewed migration.',409);
  const resolved=await resolveImage(docker,game,target);
  // Refuse a colliding recovery container before saving or stopping anything.
  let collision;try{collision=await docker('GET',route(retain)+'/json');}catch(error){if(error.status!==404)throw error;}assert(!collision,'An earlier migration recovery container already exists.',409);
  state={version:1,game,name,retain,originalId:original.Id,from:original.Config.Image,target:resolved.reference,imageId:resolved.image.Id,wasRunning:!!original.State.Running,phase:'backup',original};await save(state);
 }
 assert(state.version===1&&state.name===name&&state.game===game,'Invalid image migration journal.',409);
 if(state.phase==='complete'){const current=await docker('GET',route(name)+'/json');await owned(current);assert(current.Config.Image===state.target&&current.Image===state.imageId,'Completed migration container changed. Review this installation.',409);return state;}
 if(state.phase==='backup'){
  const original=await docker('GET',route(name)+'/json');await owned(original);assert(original.Id===state.originalId,'Container changed before migration.',409);
  state.backup=await backupStop(state);const stopped=await docker('GET',route(name)+'/json');assert(stopped.Id===state.originalId,'Game identity changed while stopping.',409);await assertCleanStop(docker,stopped,game);
  state.phase='replace';await save(state);
 }
 if(state.phase==='replace'){
  let recovery;try{recovery=await docker('GET',route(retain)+'/json');}catch(error){if(error.status!==404)throw error;}
  if(!recovery){const original=await docker('GET',route(name)+'/json');await owned(original);assert(original.Id===state.originalId&&!original.State.Running,'Original game changed during migration.',409);await docker('POST',route(name)+'/update',{RestartPolicy:{Name:'no'}});await docker('POST',route(name)+'/rename?'+new URLSearchParams({name:retain}));}
  else{await owned(recovery);assert(recovery.Id===state.originalId&&!recovery.State.Running,'Recovery container changed.',409);}
  const retired=await docker('GET',route(retain)+'/json');
  for(const network of Object.keys(retired.NetworkSettings?.Networks||{}))await docker('POST','/networks/'+encodeURIComponent(network)+'/disconnect',{Container:state.originalId});
  let replacement;try{replacement=await docker('GET',route(name)+'/json');}catch(error){if(error.status!==404)throw error;}
  if(!replacement){await docker('POST','/containers/create?'+new URLSearchParams({name,platform:'linux/amd64'}),replacementSpec(state.original,state.target,{game}));replacement=await docker('GET',route(name)+'/json');}
  await owned(replacement);assert(replacement.Config.Image===state.target&&replacement.Image===state.imageId,'Migration replacement changed.',409);
  // Persist environment/registry before allowing any game writes with new image.
  await configured(state);state.phase='verify';await save(state);
 }
 if(state.phase==='verify'){
  const replacement=await docker('GET',route(name)+'/json');await owned(replacement);assert(replacement.Image===state.imageId,'Migration replacement changed.',409);
  if(state.wasRunning){if(!replacement.State.Running)await docker('POST',route(name)+'/start');await ready(state);}
  else assert(!replacement.State.Running,'A stopped game was unexpectedly started.',409);
  state.phase=retainOriginal?'complete':'retire';if(retainOriginal)state.finished=new Date().toISOString();await save(state);
 }
 if(state.phase==='retire'){
  // Compose labels cannot be changed. A duplicate old service must not survive
  // successful standalone migration and be started against the same world later.
  const current=await docker('GET',route(name)+'/json');await owned(current);assert(current.Image===state.imageId&&current.Config.Image===state.target,'Verified replacement changed before retirement.',409);
  let retired;try{retired=await docker('GET',route(retain)+'/json');}catch(error){if(error.status!==404)throw error;}
  if(retired){await owned(retired);assert(retired.Id===state.originalId&&!retired.State.Running,'Retired container changed.',409);await docker('DELETE',route(retain));}
  state.phase='complete';state.finished=new Date().toISOString();await save(state);
 }
 return state;
}
