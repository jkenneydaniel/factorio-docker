import {ownedImages} from '../core/game-images.js';
import {assert} from '../common.js';
export const catalog=Object.freeze({
 factorio:{id:'factorio',name:'Factorio',version:'2.0.77',image:ownedImages.factorio,cpu:1,memoryGiB:2,gamePort:34197},
 rust:{id:'rust',name:'Rust',version:'Steam public branch',image:ownedImages.rust,cpu:4,memoryGiB:12,gamePort:28015,queryPort:28017},
});
export const validId=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
export const labels=(fleet,id,game)=>({'io.lobby-goblin.fleet':fleet,'io.lobby-goblin.instance':id,'io.lobby-goblin.game':game});
export function validateCreation(input){
 assert(input&&Object.hasOwn(catalog,input.game),'Choose Factorio or Rust.');const game=catalog[input.game];
 assert(typeof input.name==='string'&&input.name.trim().length>=1&&input.name.trim().length<=80&&!/[\x00-\x1f\x7f";\\]/.test(input.name),'Use a server name of 1–80 characters without commands or control characters.');
 const cpu=Number(input.cpu??game.cpu),memoryGiB=Number(input.memoryGiB??game.memoryGiB);
 assert(Number.isFinite(cpu)&&cpu>=.5&&cpu<=8&&cpu*2===Math.round(cpu*2),'CPU must be 0.5–8 in half-core steps.');
 assert(Number.isInteger(memoryGiB)&&memoryGiB>=(game.id==='rust'?8:1)&&memoryGiB<=32,'Choose 8–32 GiB for Rust or 1–32 GiB for Factorio.');
 const seed=input.seed===''||input.seed==null?null:Number(input.seed);assert(seed===null||Number.isInteger(seed)&&seed>=1&&seed<=0xffffffff,'Seed must be 1–4294967295, or blank for a new random seed.');
 const worldSize=Number(input.worldSize??2000);if(game.id==='rust')assert(Number.isInteger(worldSize)&&worldSize>=1000&&worldSize<=6000&&worldSize%100===0,'Rust map size must be 1000–6000 in steps of 100.');
 const maxPlayers=Number(input.maxPlayers??(game.id==='rust'?20:10));assert(Number.isInteger(maxPlayers)&&maxPlayers>=1&&maxPlayers<=(game.id==='rust'?1000:100),'Player limit is outside the supported range.');
 assert(input.snapshotId==null||input.snapshotId===''||validId(input.snapshotId),'Invalid snapshot.');
 assert(input.autoStart===undefined||typeof input.autoStart==='boolean','Invalid startup preference.');
 return {game:game.id,name:input.name.trim(),cpu,memoryGiB,seed,worldSize,maxPlayers,snapshotId:input.snapshotId||null,autoStart:input.autoStart!==false};
}
export function resources(fleet,id,game){assert(validId(fleet)&&validId(id)&&catalog[game],'Invalid instance identity.');return {container:`lobby-goblin-${game}-${id}`,controller:`lobby-goblin-controller-${id}`,volume:`lobby-goblin-${fleet}-${id}`,network:`lobby-goblin-${fleet}-${id}`};}
export function noManagedUpdater(current){const status=()=>({current,busy:false,jobs:[],pendingRestore:null,supported:false,message:'This server belongs to the host manager. Standalone installation updates are disabled.'});const unavailable=async()=>{throw Object.assign(Error('Standalone installation updates are disabled for managed servers.'),{status:409});};return {current,jobs:[],busy:false,pendingRestore:null,init:async()=>{},refresh:async()=>status(),status,plan:unavailable,install:unavailable,restored:async()=>{}};}
