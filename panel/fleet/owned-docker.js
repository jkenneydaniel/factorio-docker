import {assert} from '../common.js';
import {validId} from './catalog.js';
// Every child controller is fenced to its declared game/volume and its own workers.
// This also scopes legacy preview cleanup queries; unrelated installations are invisible.
export function ownedDocker(request,env){
 const fleet=env.FLEET_ID,id=env.FLEET_INSTANCE,volume=env.FLEET_VOLUME,game=env.FACTORIO_CONTAINER||env.RUST_CONTAINER;
 assert(validId(fleet)&&validId(id)&&volume===`lobby-goblin-${fleet}-${id}`,'Invalid managed installation.');
 const marker={'io.lobby-goblin.fleet':fleet,'io.lobby-goblin.instance':id};
 async function owned(ref){const info=await request('GET',`/containers/${encodeURIComponent(ref)}/json`);assert(Object.entries(marker).every(([k,v])=>info.Config?.Labels?.[k]===v),'Container belongs to a different installation.',409);
  if(ref===game||info.Name==='/'+game){const target=env.GAME_MODULE==='rust'?'/steamcmd/rust':'/factorio';assert(info.Mounts?.some(m=>m.Type==='volume'&&m.Name===volume&&m.Destination===target)&&info.HostConfig?.Mounts?.some(m=>m.Type==='volume'&&m.Source===volume&&m.Target===target&&m.VolumeOptions?.Subpath==='data'),'Managed game storage does not match.',409);}
  else assert(info.Config?.Labels?.['io.lobby-goblin.worker']==='true','Not an owned worker.',409);return info;}
 return async(method,route,data,options)=>{
  const url=new URL(route,'http://docker');const bits=url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if(url.pathname==='/containers/json'){
   const filters=JSON.parse(url.searchParams.get('filters')||'{}');filters.label=[...(filters.label||[]),...Object.entries(marker).map(([k,v])=>k+'='+v)];url.searchParams.set('filters',JSON.stringify(filters));return request(method,url.pathname+url.search,data,options);
  }
  if(url.pathname==='/containers/create'){
   const owner=await owned(game);assert(method==='POST'&&data&&[owner.Image,owner.Config.Image].includes(data.Image),'Worker image must match its game.',409);
   const host=data.HostConfig||{};assert(host.NetworkMode==='none'&&!host.Privileged&&!host.Binds&&!host.VolumesFrom&&!host.Devices&&!host.CapAdd&&host.Mounts?.length===1,'Workers require isolated storage and networking.',409);
   const mount=host.Mounts[0];assert(mount.Type==='volume'&&mount.Source===volume&&mount.Target==='/factorio'&&/^data\/\.panel-work\/[A-Za-z0-9_.-]+$/.test(mount.VolumeOptions?.Subpath||''),'Worker mount is outside its installation.',409);
   assert(Number(host.Memory)>0&&host.Memory<=2*1024**3,'Worker memory limit is required.');
   data={...data,Labels:{...data.Labels,...marker,'io.lobby-goblin.worker':'true'},HostConfig:{...host,NanoCpus:Math.min(host.NanoCpus||1000000000,1000000000),CapDrop:['ALL'],CapAdd:['CHOWN','SETUID','SETGID','DAC_OVERRIDE'],SecurityOpt:['no-new-privileges:true']}};
   return request(method,route,data,options);
  }
  if(bits[0]==='containers'&&bits.length>=2){const info=await owned(bits[1]);assert(bits.length===3&&['json','logs','stats','start','stop','restart','wait','exec'].includes(bits[2])||method==='DELETE'&&bits.length===2&&info.Config?.Labels?.['io.lobby-goblin.worker']==='true','Unsupported managed container operation.',409);return request(method,route,data,options);}
  if(bits[0]==='exec'&&bits.length===3){const info=await request('GET',`/exec/${encodeURIComponent(bits[1])}/json`);await owned(info.ContainerID);assert(['json','start'].includes(bits[2]),'Unsupported exec operation.');return request(method,route,data,options);}
  if(bits[0]==='images'&&method==='GET'&&url.pathname.endsWith('/json'))return request(method,route,data,options);
  assert(false,'This controller cannot operate other Docker resources.',409);
 };
}
