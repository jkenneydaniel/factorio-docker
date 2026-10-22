import assert from 'node:assert/strict';
import {migrateImage} from '../core/image-migration.js';
import {ownedImages} from '../core/game-images.js';
const digest='f'.repeat(64),imageId='sha256:'+digest;
export function fixture(game='factorio',{running=true}={}){
 const reference=game==='factorio'?'factoriotools/factorio:2.0.77':'didstopia/rust-server@sha256:f935f9631e53ad1a235b446496716e1ae65a8d179a3b620abf38e29b9877f88e',containers=new Map(),calls=[],journal={current:null};
 const original={Id:'old-id',Image:'sha256:old',Config:{Image:reference,Entrypoint:['/old-entrypoint'],Cmd:[],Env:game==='factorio'?['PUID=845','LOAD_LATEST_SAVE=true']:['RUST_SERVER_IDENTITY=lobby-goblin-rust','RUST_RCON_PASSWORD=private','RUST_SERVER_SEED=456','RUST_SERVER_WORLDSIZE=1000','RUST_UPDATE_CHECKING=0'],Labels:{owner:'test'},Hostname:'old-id'},HostConfig:{RestartPolicy:{Name:'unless-stopped'},Memory:1234,NanoCpus:2e9,PortBindings:{'123/udp':[{HostIp:'127.0.0.1',HostPort:'456'}]},Mounts:[{Type:'volume',Source:'test-volume',Target:game==='factorio'?'/factorio':'/steamcmd/rust',VolumeOptions:{Subpath:'data'}}]},Mounts:[{Type:'volume',Name:'test-volume',SubPath:'data',Destination:game==='factorio'?'/factorio':'/steamcmd/rust'}],State:{Running:running,ExitCode:0},NetworkSettings:{Networks:{private:{IPAddress:'test-ip',Aliases:['game','old-id'],IPAMConfig:null}}}};
 containers.set('game',original);let fail=null;
 const docker=async(method,url,data)=>{calls.push({method,url,data:structuredClone(data)});if(fail?.(method,url,data))throw Error('Injected interruption');const u=new URL(url,'http://docker'),parts=u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
 if(parts[0]==='networks'){const old=[...containers.values()].find(c=>c.Id===data.Container);delete old.NetworkSettings.Networks[parts[1]];return;}
 if(parts[0]==='images')return parts[1]==='sha256:old'?{Config:{Entrypoint:['/old-entrypoint'],Cmd:[]}}:{Id:imageId,Architecture:'amd64',Os:'linux',RepoDigests:[ownedImages[game].split(':')[0]+'@sha256:'+digest],Config:{Labels:{'io.lobby-goblin.compatibility':'1','io.lobby-goblin.game':game,'factorio.version':'2.0.77','io.lobby-goblin.image-revision':game==='factorio'?'3':'2'}}};
 if(u.pathname==='/containers/create'){containers.set(u.searchParams.get('name'),{Id:'new-'+u.searchParams.get('name'),Image:data.Image.startsWith('sha256:')?data.Image:imageId,Config:data,HostConfig:data.HostConfig,Mounts:structuredClone(original.Mounts),State:{Running:false,ExitCode:0}});return {Id:'new-id'};}
 const item=containers.get(parts[1])||[...containers.values()].find(c=>c.Id===parts[1]);if(!item)throw Object.assign(Error('Not found'),{status:404});
 if(method==='GET')return structuredClone(item);
 if(method==='DELETE'){containers.delete(parts[1]);return;}
 if(parts[2]==='stop')item.State.Running=false;
 if(parts[2]==='update')item.HostConfig.RestartPolicy=data.RestartPolicy;
 if(parts[2]==='rename'){containers.delete(parts[1]);containers.set(u.searchParams.get('name'),item);}
 if(parts[2]==='start')item.State.Running=true;return null;
 };
 const options={docker,name:'game',game,target:ownedImages[game],save:async value=>{journal.current=structuredClone(value);},owned:async info=>assert.equal(info.Config.Labels.owner,'test'),backupStop:async()=>{calls.push({operation:'verified-backup'});containers.get('game').State.Running=false;return 'verified.tar.gz';},configured:async()=>{calls.push({operation:'persist-target'});},ready:async()=>{calls.push({operation:'ready'});}};
 return {options,calls,containers,journal,run:()=>migrateImage({...options,journal:journal.current}),fail:value=>{fail=value;}};
}
