import test from 'node:test';
import assert from 'node:assert/strict';
import {ownedDocker} from '../core/owned-docker.js';

const fleet='a'.repeat(32),id='b'.repeat(32),volume=`lobby-goblin-${fleet}-${id}`,game='game';
function fixture(){
 const calls=[],owner={Id:'immutable-game-id',Name:'/game',Image:'image-id',Config:{Image:'game-image',Labels:{'io.lobby-goblin.fleet':fleet,'io.lobby-goblin.instance':id}},Mounts:[{Type:'volume',Name:volume,Destination:'/factorio'}],HostConfig:{Mounts:[{Type:'volume',Source:volume,Target:'/factorio',VolumeOptions:{Subpath:'data'}}]}};
 const request=async(method,route,data)=>{calls.push({method,route,data});if(route==='/exec/known/json')return {ContainerID:'immutable-game-id'};if(method==='GET'&&route.startsWith('/containers/')&&route.endsWith('/json'))return owner;return {Id:'worker'};};
 const docker=ownedDocker(request,{FLEET_ID:fleet,FLEET_INSTANCE:id,FLEET_VOLUME:volume},{container:game,dataTarget:'/factorio',previewWorker:{root:'state/.panel-work',target:'/factorio'}});
 return {calls,docker,owner};
}
test('managed Docker fencing rejects method confusion, arbitrary images, absolute URLs and privileged exec before mutations',async()=>{
 const f=fixture();
 for(const [method,route,data] of [['POST','/containers/json'],['GET','/containers/game/stop'],['POST','/containers/game/json'],['DELETE','/containers/game/start'],['GET','/images/foreign/json'],['POST','http://other/containers/create'],['POST','//other/containers/create'],['POST','/containers/game/exec',{Cmd:['sh'],Privileged:true}],['POST','/exec/known/start',{Detach:true,Tty:false}]])await assert.rejects(f.docker(method,route,data));
 assert.ok(f.calls.every(call=>call.method==='GET'));
 await f.docker('POST','/containers/game/stop');assert.equal(f.calls.at(-1).route,'/containers/immutable-game-id/stop');
});
test('managed workers cannot attach host namespaces, devices, sockets or extra networks and retain bounded resources',async()=>{
 const f=fixture(),worker={Image:'image-id',HostConfig:{NetworkMode:'none',Memory:1024**3,Mounts:[{Type:'volume',Source:volume,Target:'/factorio',VolumeOptions:{Subpath:'state/.panel-work/isolated'}}]}};
 for(const extra of [{Privileged:true},{PidMode:'host'},{IpcMode:'host'},{DeviceRequests:[{}]},{Binds:['/var/run/docker.sock:/socket']},{SecurityOpt:['seccomp=unconfined'],CapAdd:['SYS_ADMIN']}])await assert.rejects(f.docker('POST','/containers/create?name=worker',{...worker,HostConfig:{...worker.HostConfig,...extra}}));
 await assert.rejects(f.docker('POST','/containers/create',{...worker,NetworkingConfig:{EndpointsConfig:{other:{}}}}));
 await assert.rejects(f.docker('POST','/containers/create',{...worker,HostConfig:{...worker.HostConfig,Mounts:[{...worker.HostConfig.Mounts[0],VolumeOptions:{...worker.HostConfig.Mounts[0].VolumeOptions,DriverConfig:{Name:'local',Options:{device:'/'}}}}]}}));
 assert.ok(f.calls.every(call=>call.method==='GET'));
 await f.docker('POST','/containers/create?name=worker',worker);
 const spec=f.calls.at(-1).data;assert.equal(spec.HostConfig.NetworkMode,'none');assert.equal(spec.HostConfig.PidsLimit,256);assert.equal(spec.HostConfig.NanoCpus,1e9);assert.deepEqual(spec.HostConfig.SecurityOpt,['no-new-privileges:true']);
 assert.equal(spec.HostConfig.Mounts[0].Source,volume);
});
