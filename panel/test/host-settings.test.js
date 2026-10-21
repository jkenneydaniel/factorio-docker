import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FleetManager} from '../fleet/manager.js';
import {startFleetController} from '../fleet/controller.js';

const fleet='a'.repeat(32),giB=1024**3;
async function fixture(t,{budget=24}={}){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'lobby-host-settings-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const library=path.join(root,'library'),state=path.join(root,'state');let memory=32*giB,offline=false;const calls=[];
 const docker=async(method,route)=>{calls.push({method,route});assert.equal(method,'GET','Settings must never mutate Docker resources');if(route==='/info'){if(offline)throw Error('Offline');return {MemTotal:memory};}if(route==='/containers/host/json')return {Config:{Labels:{'io.lobby-goblin.fleet':fleet,'io.lobby-goblin.role':'host-controller'}}};throw Error('Unexpected route '+route);};
 const options={docker,root:state,library,fleet,stateVolume:`lobby-goblin-fleet-${fleet}-state`,libraryVolume:`lobby-goblin-fleet-${fleet}-library`,image:'test:settings',hostContainer:'host',memoryBudgetGiB:budget};
 const manager=new FleetManager(options);await manager.init();return {root,manager,options,calls,setMemory:value=>memory=value,setOffline:value=>offline=value};
}
const allocation=(id,name,memoryGiB,state='installed')=>({id:id.repeat(32),name,game:'factorio',memoryGiB,state});

test('host settings show game plus controller limits, count stopped and attention servers, and exclude removed data',async t=>{
 const f=await fixture(t);f.manager.state.servers=[allocation('b','Factory',3),allocation('c','Stopped',8,'stopped'),allocation('d','Incomplete',2,'attention'),allocation('e','Removed',20,'removed')];
 const value=await f.manager.hostSettings();assert.equal(value.allocatedMemoryGiB,16);assert.equal(value.availableMemoryGiB,8);assert.equal(value.dockerMemoryGiB,32);assert.equal(value.maxMemoryBudgetGiB,30);assert.equal(value.minMemoryBudgetGiB,16);assert.equal(value.allocations.length,3);assert.equal(value.allocations[0].controllerGiB,1);assert.equal(value.allocations[0].totalGiB,4);
});

test('saving a budget applies immediately, survives restart and overrides the environment default',async t=>{
 const f=await fixture(t,{budget:16});f.manager.state.servers=[allocation('b','Factory',3)];
 const value=await f.manager.updateHostSettings({memoryBudgetGiB:24,revision:0},'owner');assert.equal(value.memoryBudgetGiB,24);assert.equal(value.revision,1);assert.equal(value.availableMemoryGiB,20);assert.equal(f.manager.memoryBudgetGiB,24);
 const saved=JSON.parse(await fs.readFile(path.join(f.options.root,'registry.json'),'utf8'));assert.equal(saved.settings.updatedBy,'owner');assert.equal(saved.servers[0].memoryGiB,3);
 const restart=new FleetManager({...f.options,memoryBudgetGiB:8});await restart.init();assert.equal((await restart.hostSettings()).memoryBudgetGiB,24);assert.equal((await restart.hostSettings()).revision,1);assert.ok(f.calls.every(c=>c.method==='GET'));
});

test('budget validation refuses overcommit, fractional values, stale drafts and unavailable Docker without changing state',async t=>{
 const f=await fixture(t);f.manager.state.servers=[allocation('b','Factory',3)];
 for(const memoryBudgetGiB of [1,3,24.5,31,129,'24',Infinity])await assert.rejects(f.manager.updateHostSettings({memoryBudgetGiB,revision:0}));
 for(const input of [null,[],{}, {memoryBudgetGiB:24,revision:99}])await assert.rejects(f.manager.updateHostSettings(input));
 assert.equal(f.manager.memoryBudgetGiB,24);assert.equal(f.manager.state.settings,undefined);assert.equal(f.manager.settingsUpdating,false);
 f.setOffline(true);assert.equal((await f.manager.hostSettings()).dockerMemoryGiB,null);await assert.rejects(f.manager.updateHostSettings({memoryBudgetGiB:20,revision:0}),/unavailable/);f.setOffline(false);
 await f.manager.updateHostSettings({memoryBudgetGiB:20,revision:0});await assert.rejects(f.manager.updateHostSettings({memoryBudgetGiB:22,revision:0}),/another session/);assert.equal(f.manager.memoryBudgetGiB,20);
});

test('settings serialize against host jobs and other administrators, and failed persistence keeps the prior budget',async t=>{
 const f=await fixture(t);f.manager.active={id:'running'};await assert.rejects(f.manager.updateHostSettings({memoryBudgetGiB:20,revision:0}),/current host operation/);f.manager.active=null;
 let release;const original=f.manager.hostSettings.bind(f.manager);f.manager.hostSettings=async()=>{await new Promise(r=>{release=r;});return original();};
 const pending=f.manager.updateHostSettings({memoryBudgetGiB:20,revision:0});await assert.rejects(f.manager.updateHostSettings({memoryBudgetGiB:22,revision:0}),/current host operation/);await assert.rejects(f.manager.submit('create',{game:'factorio',name:'Blocked'}),/current host operation/);release();await pending;
 f.manager.hostSettings=original;const persist=f.manager.persist.bind(f.manager);f.manager.persist=async()=>{throw Error('Disk full');};await assert.rejects(f.manager.updateHostSettings({memoryBudgetGiB:22,revision:1}),/Disk full/);assert.equal(f.manager.memoryBudgetGiB,20);assert.equal(f.manager.state.settings.revision,1);assert.equal(f.manager.settingsUpdating,false);f.manager.persist=persist;
});

test('controller exposes settings over its authenticated route and persists the authenticated actor',async t=>{
 const f=await fixture(t),web=path.join(f.root,'web');const {server}=await startFleetController({docker:f.options.docker,port:0,hostname:'127.0.0.1',env:{FLEET_ROOT:f.options.root,FLEET_LIBRARY:f.options.library,FLEET_WEB_ROOT:web,FLEET_ID:fleet,FLEET_STATE_VOLUME:f.options.stateVolume,FLEET_LIBRARY_VOLUME:f.options.libraryVolume,FLEET_IMAGE:'test:settings',FLEET_HOST_CONTAINER:'host',FLEET_MEMORY_GIB:'24'}});
 t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));const origin='http://127.0.0.1:'+server.address().port,token=(await fs.readFile(path.join(web,'secrets/controller-token'),'utf8')).trim();
 assert.equal((await fetch(origin+'/host-settings')).status,401);const headers={authorization:'Bearer '+token,'content-type':'application/json','x-panel-user':'owner'};
 assert.equal((await(await fetch(origin+'/host-settings',{headers})).json()).memoryBudgetGiB,24);
 const result=await fetch(origin+'/host-settings',{method:'POST',headers,body:JSON.stringify({memoryBudgetGiB:20,revision:0})});assert.equal(result.status,200);assert.equal((await result.json()).memoryBudgetGiB,20);
 const state=JSON.parse(await fs.readFile(path.join(f.options.root,'registry.json'),'utf8'));assert.equal(state.settings.updatedBy,'owner');
});
