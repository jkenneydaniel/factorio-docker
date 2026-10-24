import path from 'node:path';
import fs from 'node:fs/promises';
import {applicationWeb} from '../../core/application-web.js';
import {action,backupActions} from '../../core/game-contract.js';
import {json,assert,writeJSON} from '../../common.js';
import {zipEntries} from '../../core/archive.js';
import {applicationDefinition,isApplicationDefinition} from '../../core/application-definition.js';
import {applicationMetadata} from '../../core/application-services.js';
import {compileManagedDefinition} from '../../core/managed-definition.js';
import {imageMatch} from '../../core/image-policy.js';
import source from './arena-definition.json' with {type:'json'};
import {noManagedUpdater} from '../../core/managed-updater.js';
import presentation from './arena-presentation.json' with {type:'json'};
import {presentationScreens} from '../../core/application-presentation.js';
export const definition=applicationDefinition(source,presentation);
export const imagePolicy=definition.services[0].configuration.imagePolicy;
export function arena(root,{runtimeDefinition=source}={}) {
  const declared=runtimeDefinition===source?definition:isApplicationDefinition(runtimeDefinition)?runtimeDefinition:applicationDefinition(runtimeDefinition,presentation),policy=declared.services[0].configuration.imagePolicy;
  const validateBackup=buffer=>{const entries=zipEntries(buffer);assert(entries.length===1&&entries[0].name==='score.json','Unexpected arena archive.');const value=JSON.parse(entries[0].read());assert(Number.isSafeInteger(value.score),'Invalid arena score.');return {files:1};};
  const managed=compileManagedDefinition(declared,{
    async prepareStorage({data}){await fs.mkdir(path.join(data,'matches'),{recursive:true});},
    async configureStorage({data,config}){await writeJSON(path.join(data,'settings.json'),{tickRate:config.tickRate});if(!config.snapshotId)await writeJSON(path.join(data,'matches/current.json'),{score:0});await fs.copyFile(new URL('./arena-server.js',import.meta.url),path.join(data,'bootstrap.cjs'));},
    snapshots:{compatible:(from,to)=>!!imageMatch(policy,from)&&!!imageMatch(policy,to)&&from.split('@')[0]===to.split('@')[0]&&(!from.includes('@')||!to.includes('@')||from===to),
      async collect({backup,content}){const buffer=await fs.readFile(backup);validateBackup(buffer);await fs.writeFile(path.join(content,'match.json'),zipEntries(buffer)[0].read());},
      async restore({root,data,manifest}){assert(manifest.files.length===1&&manifest.files[0].name==='match.json','Unexpected arena snapshot.');await fs.copyFile(path.join(root,'match.json'),path.join(data,'matches/current.json'));}},
  });
  const contract={version:2,features:{backups:true},backup:{strategy:'files',extension:'.zip',mediaType:'application/zip',interruption:false},
      actions:{...backupActions(),start:action('Start arena',false,'convergent','server.operate'),stop:action('Stop arena',true,'convergent','server.operate'),restart:action('Restart arena',true,'manual','server.operate'),rotate:action('Rotate arena',false,'manual','game.arena.rotate')},
      routes:{'/score':{GET:'viewer'}},screens:presentationScreens(presentation),
      policy:{version:1,permissions:{'game.arena.rotate':'Rotate the arena'},routes:{'/score':{GET:'server.view'}}}};
  let score=0,memoryRunning=true;
  return {
    id:'arena',name:'Arena',definition:declared,application:applicationMetadata(declared),managed,releaseRepository:'fixture/arena',imagePolicy:policy,routes:['/score'],presentation:declared.presentation,
    contract,
    configuration:(env={})=>({state:env.STATE_DIR||path.join(root,'state'),data:env.ARENA_DATA||path.join(root,'data'),library:path.join(root,'library'),backupDir:path.join(root,'backups/arena-backups'),container:env.ARENA_CONTAINER||'arena-fixture'}),
    createUpdater:()=>noManagedUpdater('fixture'),diagnostics:async()=>({checks:[]}),
    web:applicationWeb('arena',contract),
    async createController(ctx){
      const live=ctx.env.ARENA_LIVE_RUNTIME==='true';
      const query=async(action='/score')=>{const response=await fetch(`http://${ctx.config.container}:7777`+action,{method:action==='/rotate'?'POST':'GET',signal:AbortSignal.timeout(3000)});assert(response.ok,'Arena fixture is unavailable.',503);return response.json();};
      const current=async()=>live?(await query()).score:score;
      return {
      actions:{rotate:async()=>{if(live)return query('/rotate');score++;return {score};},start:async()=>{if(live)await ctx.host.control('start');else memoryRunning=true;return 'Arena ready.';},stop:async()=>{if(live)await ctx.host.control('stop');else memoryRunning=false;return 'Arena stopped.';},restart:async()=>{if(live){await ctx.host.control('stop');await ctx.host.control('start');}else memoryRunning=true;return 'Arena restarted.';}},
      status:async()=>{if(!live)return {ready:memoryRunning,running:memoryRunning,score,activeJob:ctx.active};const info=await ctx.host.info();if(!info.State.Running)return {ready:false,running:false,score:null,activeJob:ctx.active};try{return {...await query(),running:true,activeJob:ctx.active};}catch{return {ready:false,running:true,error:'Arena is not ready.',activeJob:ctx.active};}},
      handle:async(_req,res)=>json(res,200,{score:await current()}),validateAction(){},
      backupFiles:async()=>[{name:'score.json',data:Buffer.from(JSON.stringify({score:await current()}))}],validateBackup,backupVerified:()=>true,
      async init(){},async start(){},async beforeJob(){},async afterJob(){},async waitIdle(){},invalidate(){},recentStatus:()=>null,locations:[],
    };},
  };
}
