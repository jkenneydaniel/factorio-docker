import fs from 'node:fs/promises';import http from 'node:http';
import {FleetManager} from './manager.js';import {catalog,validId,noManagedUpdater} from './catalog.js';import {docker as dockerAPI} from '../core/docker.js';import {selectedGame} from '../games/index.js';
import {assert,equalSecret,json,requestJSON,readBody,redact} from '../common.js';import {initializePanel} from '../init.js';
export async function startFleetController({env=process.env,docker=dockerAPI,port=Number(env.PORT||8091),hostname='0.0.0.0'}={}){
 const root=env.FLEET_ROOT||'/fleet',library=env.FLEET_LIBRARY||'/library',webRoot=env.FLEET_WEB_ROOT||'/web-state';
 await initializePanel(webRoot,env.FLEET_PANEL_URL||'http://localhost:8082');const token=(await fs.readFile(webRoot+'/secrets/controller-token','utf8')).trim();
 const manager=new FleetManager({docker,root,library,fleet:env.FLEET_ID,stateVolume:env.FLEET_STATE_VOLUME,libraryVolume:env.FLEET_LIBRARY_VOLUME,image:env.FLEET_IMAGE,hostContainer:env.FLEET_HOST_CONTAINER,address:env.FLEET_GAME_ADDRESS||'localhost',bind:env.FLEET_GAME_BIND||'0.0.0.0',memoryBudgetGiB:Number(env.FLEET_MEMORY_GIB||16),portBase:Number(env.FLEET_GAME_PORT_BASE||35000)});await manager.init();await manager.reconnect();
 async function handle(req,res){
  if(req.url==='/health')return json(res,200,{ok:true});assert(equalSecret(req.headers.authorization,'Bearer '+token),'Unauthorized.',401);const url=new URL(req.url,'http://host-manager');
  if(req.method==='GET'&&url.pathname==='/catalog')return json(res,200,{games:Object.values(catalog),memoryBudgetGiB:manager.memoryBudgetGiB});
  if(req.method==='GET'&&url.pathname==='/status')return json(res,200,{game:'fleet',ready:true,servers:manager.list().length,activeJob:manager.active});
  if(req.method==='GET'&&url.pathname==='/jobs')return json(res,200,{jobs:manager.state.jobs,active:manager.active});
  if(req.method==='GET'&&url.pathname==='/snapshots')return json(res,200,{snapshots:manager.state.snapshots});
  if(url.pathname==='/servers'){
   if(req.method==='GET')return json(res,200,{servers:manager.list()});assert(req.method==='POST','Not found.',404);return json(res,202,await manager.submit('create',await requestJSON(req),req.headers['x-panel-user']||'administrator'));
  }
  if(req.method==='GET'&&url.pathname==='/update-status')return json(res,200,await noManagedUpdater('0.3.0-alpha').refresh());
  const match=url.pathname.match(/^\/servers\/([a-f0-9]{32})(?:\/(.*))?$/);assert(match,'Not found.',404);const item=manager.server(match[1]),tail=match[2]||'';
  if(!tail&&req.method==='GET')return json(res,200,manager.publicServer(item));
  if(req.method==='POST'&&['snapshot','remove'].includes(tail)){const body=await requestJSON(req);return json(res,202,await manager.submit(tail==='snapshot'?'publish':'remove',{...body,serverId:item.id},req.headers['x-panel-user']||'administrator'));}
  assert(tail.startsWith('controller/')&&item.state!=='removed','This server is unavailable. Its stored data has been preserved.',409);const route='/'+tail.slice(11),module=selectedGame(item.game);
  assert(['/status','/diagnostics','/backups','/jobs','/download','/schedule','/backup-retention','/update-status','/update-plan','/update-install',...module.routes].includes(route),'Not found.',404);
  assert(['GET','POST'].includes(req.method),'Not found.',404);assert(req.method==='GET'||!item.maintenance,'A host operation is using this server. Wait for it to finish.',409);
  await manager.ownedContainer(item.controller,item.id);let body;if(req.method==='POST')body=await readBody(req,route==='/upload'?128*1024**2:1024**2);
  const response=await fetch(`http://${item.controller}:8081${route}${url.search}`,{method:req.method,headers:{authorization:'Bearer '+item.controllerToken,'content-type':req.headers['content-type']||'application/json','x-panel-user':req.headers['x-panel-user']||'administrator'},body,signal:AbortSignal.timeout(route==='/download'?300000:30000)});
  for(const key of ['content-type','content-disposition'])if(response.headers.has(key))res.setHeader(key,response.headers.get(key));res.setHeader('cache-control','no-store');res.writeHead(response.status);if(response.body)for await(const b of response.body)if(!res.write(b))await new Promise(resolve=>res.once('drain',resolve));res.end();
 }
 const server=http.createServer((req,res)=>handle(req,res).catch(error=>{if(!res.headersSent)json(res,error.status||502,{error:error.status?redact(error.message):'The host manager could not complete the request.'});else res.end();}));server.requestTimeout=300000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,hostname,resolve);});return {server,manager};
}
