// Disposable loopback-only UI acceptance fixture. No Docker socket, production
// accounts, game data or game operations. Only a temporary host budget can change.
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FleetManager} from '../fleet/manager.js';
import {startFleetWeb} from '../fleet/web.js';
import {catalog} from '../fleet/catalog.js';
import {hashPassword} from '../auth.js';
import {writeJSON,json,requestJSON,assert} from '../common.js';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'lobby-host-ui-')),auth=path.join(root,'auth'),tokenFile=path.join(root,'token'),token='f'.repeat(64),fleet='a'.repeat(32);
await fs.mkdir(auth);await fs.writeFile(tokenFile,token);await writeJSON(path.join(auth,'users.json'),{Preview:{...hashPassword('isolated-panel-preview-password'),role:'admin'},Viewer:{...hashPassword('isolated-panel-preview-password'),role:'viewer'}});
const manager=new FleetManager({root:path.join(root,'state'),library:path.join(root,'library'),fleet,stateVolume:`lobby-goblin-fleet-${fleet}-state`,libraryVolume:`lobby-goblin-fleet-${fleet}-library`,hostContainer:'fixture',image:'fixture',memoryBudgetGiB:24,docker:async(method,route)=>{assert(method==='GET'&&route==='/info','This preview cannot use Docker.');return {MemTotal:32*1024**3};}});await manager.init();
manager.state.servers=[{id:'b'.repeat(32),game:'factorio',name:'Friday factory',state:'installed',memoryGiB:3,cpu:2,gamePort:35000},{id:'c'.repeat(32),game:'rust',name:'Island crew',state:'installed',memoryGiB:12,cpu:4,gamePort:35003}];await manager.persist();
const backend=http.createServer((req,res)=>{void(async()=>{
 assert(req.headers.authorization==='Bearer '+token,'Unauthorized',401);
 if(req.url==='/host-settings'){if(req.method==='GET')return json(res,200,await manager.hostSettings());return json(res,200,await manager.updateHostSettings(await requestJSON(req),'preview'));}
 assert(req.method==='GET','Game operations are unavailable in this preview.',403);
 if(req.url==='/catalog')return json(res,200,{games:Object.values(catalog)});
 if(req.url==='/servers')return json(res,200,{servers:manager.list()});
 if(req.url==='/snapshots')return json(res,200,{snapshots:[]});
 if(req.url==='/jobs')return json(res,200,{jobs:[],active:null});
 if(req.url==='/update-status')return json(res,200,{busy:false});
 const match=req.url.match(/^\/servers\/([a-f0-9]{32})(\/controller\/status)?$/);
 if(match){const item=manager.server(match[1]);return json(res,200,match[2]?{ready:item.game==='factorio',running:item.game==='factorio',state:item.game==='factorio'?'running':'exited',players:[],memory:0}:manager.publicServer(item));}
 json(res,404,{error:'Unavailable in isolated preview.'});
 })().catch(error=>json(res,error.status||500,{error:error.message}));});
await new Promise(r=>backend.listen(0,'127.0.0.1',r));
const web=await startFleetWeb({env:{AUTH_DIR:auth,CONTROLLER_TOKEN_FILE:tokenFile,CONTROLLER_URL:'http://127.0.0.1:'+backend.address().port,PANEL_HOSTS:'127.0.0.1,localhost'},port:Number(process.env.UI_PREVIEW_PORT||8098),hostname:'127.0.0.1'});
let shutting=false;async function cleanup(){if(shutting)return;shutting=true;web.closeAllConnections();backend.closeAllConnections();await Promise.all([new Promise(r=>web.close(r)),new Promise(r=>backend.close(r))]);await fs.rm(root,{recursive:true,force:true});}
process.on('SIGINT',()=>void cleanup().then(()=>process.exit()));process.on('SIGTERM',()=>void cleanup().then(()=>process.exit()));
console.log('Disposable host-settings UI fixture ready on loopback. Only temporary settings can change.');
