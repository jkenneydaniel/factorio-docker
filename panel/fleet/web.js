import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {startWeb} from '../core/web.js';import {selectedGame,registeredGames} from '../games/index.js';import {Accounts} from '../core/accounts.js';import {assert,json} from '../common.js';
import {remoteGateway} from './agent-web.js';
export async function startFleetWeb({env=process.env,port=Number(env.PORT||8080),hostname='0.0.0.0'}={}){
 const auth=env.AUTH_DIR||'/web-state/auth',file=env.CONTROLLER_TOKEN_FILE||'/web-state/secrets/controller-token',token=(await fs.readFile(file,'utf8')).trim(),controller=env.CONTROLLER_URL||'http://fleet-controller:8091';
 const accounts=new Accounts(auth),sessions=new Map(),children=new Map();
 accounts.onDelete=async user=>{for(const module of registeredGames())await module.web.deleteAccountData?.(accounts,user);};
 const gateway=remoteGateway({env,controller,token});
 const web={Accounts,sessionCookie:'fleet_session',accountRoutes:[],adminReadRoutes:['/host-pairing','/host-setup'],assets:{'/':['fleet/index.html','text/html; charset=utf-8'],'/fleet.js':['fleet/app.js','text/javascript; charset=utf-8'],'/fleet.css':['fleet/style.css','text/css; charset=utf-8']},diagnosticsReport:(version,data)=>({version,...data}),validateOnboarding:value=>assert(value.ready,'The host manager is unavailable.'),allowRoute:route=>/^\/servers(?:\/[a-f0-9]{32}(?:\/(?:snapshot|remove))?)?$/.test(route)||['/catalog','/snapshots','/host-settings','/hosts','/host-pairing','/host-setup','/host-setup-plan'].includes(route)||/^\/hosts\/[a-f0-9]{32}\/(?:catalog|servers(?:\/[a-f0-9]{32}\/(?:snapshot|remove))?|snapshots|jobs|host-settings|disconnect|agent-status|agent-update|agent-update-plan)$/.test(route),
  async dispatch(req,res,url,context){
   if(await gateway(req,res,url))return true;
   const match=url.pathname.match(/^((?:\/hosts\/[a-f0-9]{32})?\/servers\/([a-f0-9]{32}))(\/.*)?$/);if(!match)return false;
   const user=await context.session(req);if(!user){if(match[3]?.startsWith('/api/'))json(res,401,{error:'Sign in from the server list to continue.'});else{res.writeHead(302,{location:'/'});res.end();}return true;}
   const prefix=match[1],id=match[2],tail=match[3];if(!tail){res.writeHead(302,{location:prefix+'/'});res.end();return true;}
   // Always re-read registration; removed instances cannot retain a working web route.
   const response=await fetch(controller+prefix,{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});assert(response.ok,response.status===404?'Server not found.':'This host is unavailable or access was revoked.',response.status===404?404:502);const info=await response.json();assert(info.state!=='removed','This server was removed. Its data volume was kept.',410);
   if(!children.has(prefix)){
    const scope=prefix.startsWith('/hosts/')?crypto.createHash('sha256').update(prefix).digest('hex').slice(0,32):id;
    const module=selectedGame(info.game),extensions=module.web.accountExtensions?.(accounts,scope)||{},scopedAccounts=new Proxy(accounts,{get(target,key){if(Object.hasOwn(extensions,key))return extensions[key];const value=target[key];return typeof value==='function'?value.bind(target):value;}});
    const child=await startWeb({...module,web:{...module.web,sessionCookie:'fleet_session'}},{env:{...env,AUTH_DIR:auth,CONTROLLER_URL:controller+prefix+'/controller',CONTROLLER_TOKEN_FILE:file,RELEASE_CHECKS:'false'},accounts:scopedAccounts,sessions,controllerToken:token,listen:false,assetPrefix:prefix});children.set(prefix,child);
   }
   req.url=tail+url.search;children.get(prefix).emit('request',req,res);return true;
  },
 };
 const module={id:'fleet',name:'Lobby Goblin host manager',releaseRepository:'jkenneydaniel/lobby-goblin',routes:['/servers','/catalog','/snapshots'],web,configuration:()=>({}),createController:()=>{},createUpdater:()=>{},diagnostics:()=>{}};
 web.assets['/fleet-hosts.js']=['fleet/hosts.js','text/javascript; charset=utf-8'];
 web.assets['/fleet-onboarding.js']=['fleet/onboarding.js','text/javascript; charset=utf-8'];
 const server=await startWeb(module,{env:{...env,AUTH_DIR:auth,CONTROLLER_URL:controller,CONTROLLER_TOKEN_FILE:file,RELEASE_CHECKS:'false'},accounts,sessions,controllerToken:token,port,hostname});
 server.once('close',()=>{for(const child of children.values())child.emit('close');});return server;
}
