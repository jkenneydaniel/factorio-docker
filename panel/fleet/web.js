import fs from 'node:fs/promises';
import {startWeb} from '../core/web.js';import {selectedGame} from '../games/index.js';import {Accounts} from '../games/factorio/accounts.js';import {assert,json} from '../common.js';
export async function startFleetWeb({env=process.env,port=Number(env.PORT||8080),hostname='0.0.0.0'}={}){
 const auth=env.AUTH_DIR||'/web-state/auth',file=env.CONTROLLER_TOKEN_FILE||'/web-state/secrets/controller-token',token=(await fs.readFile(file,'utf8')).trim(),controller=env.CONTROLLER_URL||'http://fleet-controller:8091';
 const accounts=new Accounts(auth),sessions=new Map(),children=new Map();
 const web={Accounts,sessionCookie:'fleet_session',accountRoutes:[],adminReadRoutes:[],assets:{'/':['fleet/index.html','text/html; charset=utf-8'],'/fleet.js':['fleet/app.js','text/javascript; charset=utf-8'],'/fleet.css':['fleet/style.css','text/css; charset=utf-8']},diagnosticsReport:(version,data)=>({version,...data}),validateOnboarding:value=>assert(value.ready,'The host manager is unavailable.'),allowRoute:route=>/^\/servers(?:\/[a-f0-9]{32}(?:\/(?:snapshot|remove))?)?$/.test(route)||['/catalog','/snapshots'].includes(route),
  async dispatch(req,res,url,context){
   const match=url.pathname.match(/^\/servers\/([a-f0-9]{32})(\/.*)?$/);if(!match)return false;
   const user=await context.session(req);if(!user){if(match[2]?.startsWith('/api/'))json(res,401,{error:'Sign in from the server list to continue.'});else{res.writeHead(302,{location:'/'});res.end();}return true;}
   const id=match[1];if(!match[2]){res.writeHead(302,{location:`/servers/${id}/`});res.end();return true;}
   // Always re-read registration; removed instances cannot retain a working web route.
   const response=await fetch(controller+'/servers/'+id,{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});assert(response.ok,'Server not found.',404);const info=await response.json();assert(info.state!=='removed','This server was removed. Its data volume was kept.',410);
   if(!children.has(id)){
    const module=selectedGame(info.game),scopedAccounts=new Proxy(accounts,{get(target,key){if(key==='worldSetups')return (username,body)=>target.worldSetups(username,body,id);const value=target[key];return typeof value==='function'?value.bind(target):value;}});
    const child=await startWeb({...module,web:{...module.web,sessionCookie:'fleet_session'}},{env:{...env,AUTH_DIR:auth,CONTROLLER_URL:controller+`/servers/${id}/controller`,CONTROLLER_TOKEN_FILE:file,RELEASE_CHECKS:'false'},accounts:scopedAccounts,sessions,controllerToken:token,listen:false,assetPrefix:`/servers/${id}`});children.set(id,child);
   }
   req.url=match[2]+url.search;children.get(id).emit('request',req,res);return true;
  },
 };
 const module={id:'fleet',name:'Lobby Goblin host manager',releaseRepository:'jkenneydaniel/lobby-goblin',routes:['/servers','/catalog','/snapshots'],web,configuration:()=>({}),createController:()=>{},createUpdater:()=>{},diagnostics:()=>{}};
 const server=await startWeb(module,{env:{...env,AUTH_DIR:auth,CONTROLLER_URL:controller,CONTROLLER_TOKEN_FILE:file,RELEASE_CHECKS:'false'},accounts,sessions,controllerToken:token,port,hostname});
 server.once('close',()=>{for(const child of children.values())child.emit('close');});return server;
}
