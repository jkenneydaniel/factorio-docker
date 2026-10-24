import {managementMaintenance} from '../core/management-maintenance.js';
import fs from 'node:fs/promises';
import http from 'node:http';
import http2 from 'node:http2';
import {readAgentIdentity} from './agent-identity.js';
import {assert,json,readBody} from '../common.js';
import {checkOrigin,panelOrigin} from '../auth.js';
import {proxyResponse} from '../core/proxy.js';
import {remoteRoute} from './hosts.js';

// The agent exposes the machine protocol only: no panel, accounts or sessions.
export function remoteGateway({env,controller,token}){
 const attempts=new Map();
 return async(req,res,url)=>{
  if(!url.pathname.startsWith('/remote/v1/'))return false;
  assert(env.PANEL_ORIGIN?.startsWith('https://'),'Remote pairing requires this installation’s configured HTTPS origin.',403);
  const route=url.pathname.slice('/remote/v1'.length),pair=route==='/pair';
  assert(pair&&req.method==='POST'||route==='/disconnect'&&req.method==='POST'||remoteRoute(req.method,route),'Remote route not found.',404);
  if(pair){
   const now=Date.now();for(const [key,value] of attempts)if(value.expires<now)attempts.delete(key);
   const key=req.socket.remoteAddress,entry=attempts.get(key)||{count:0,expires:now+600000};assert(entry.count<30&&(attempts.has(key)||attempts.size<2000),'Too many pairing attempts. Retry in ten minutes.',429);entry.count++;attempts.set(key,entry);
  }
  const bearer=req.headers.authorization;assert(pair||typeof bearer==='string'&&/^Bearer [A-Za-z0-9_-]{43}$/.test(bearer),'Remote host authentication is required.',401);
  if(!pair&&req.method==='POST'){
   const authorization=await fetch(controller+'/remote/v1/authorize',{headers:{authorization:'Bearer '+token,'x-host-token':bearer.slice(7)},redirect:'error',signal:AbortSignal.timeout(5000)});await authorization.body?.cancel();assert(authorization.ok,'This panel is not paired or its access was revoked.',authorization.status===401?401:502);
  }
  const body=req.method==='POST'?await readBody(req,route.endsWith('/upload')?128*1024**2:1024**2):undefined;
  await proxyResponse(req,res,controller+url.pathname+url.search,{headers:{authorization:'Bearer '+token,'x-host-token':pair?'':bearer.slice(7),'content-type':req.headers['content-type']||'application/json','x-panel-user':req.headers['x-panel-user']||'administrator','x-panel-update-kind':req.headers['x-panel-update-kind']==='game'?'game':'any'},body,download:route.endsWith('/download'),timeout:route.endsWith('/mod-library')||route.endsWith('/mod-library-plan')?150000:30000});return true;
 };
}

export async function startHostAgentWeb({env=process.env,port=Number(env.PORT||8080),hostname='0.0.0.0'}={}){
 const origin=panelOrigin(env.PANEL_ORIGIN);assert(origin?.startsWith('https://'),'The host agent requires its HTTPS origin.');
 const token=(await fs.readFile(env.CONTROLLER_TOKEN_FILE||'/web-state/secrets/controller-token','utf8')).trim();
 const maintenance=await managementMaintenance(env.FLEET_WEB_ROOT||'/web-state',env,{readOnly:true});
 const gateway=remoteGateway({env,token,controller:env.CONTROLLER_URL||'http://fleet-controller:8091'});
 const persistent=env.AGENT_TRANSPORT==='persistent',identity=persistent?await readAgentIdentity(env.FLEET_WEB_ROOT||'/web-state'):null;
 const handler=(req,res)=>void(async()=>{
  if(persistent)req.setTimeout(180000,()=>req.destroy());
  res.setHeader('x-content-type-options','nosniff');res.setHeader('cache-control','no-store');if(!persistent)res.setHeader('strict-transport-security','max-age=31536000');
  await maintenance.refresh();
  if(req.method==='GET'&&req.url==='/health')return json(res,200,{ok:true});
  if(await maintenance.handle(req,res,new URL(req.url,'http://management'),{token}))return;
  maintenance.assertAvailable();
  req.headers.host??=req.headers[':authority'];checkOrigin(req,[new URL(origin).hostname],origin);const url=new URL(req.url,origin);
  assert(await gateway(req,res,url),'This is a Lobby Goblin game host agent. Open your main panel to manage it.',404);
 })().catch(error=>{if(res.destroyed||res.writableEnded)return;if(!res.headersSent)json(res,error.status||502,{error:error.status?error.message:'The host agent is unavailable.'});else res.destroy();});
 const server=persistent?http2.createSecureServer({...identity,minVersion:'TLSv1.3',settings:{maxConcurrentStreams:32,maxHeaderListSize:16384},maxSessionMemory:16},handler):http.createServer(handler);
 const sessions=new Set();server.on('session',session=>{session.on('error',()=>{});if(sessions.size>=64){session.destroy();return;}sessions.add(session);session.once('close',()=>sessions.delete(session));session.setTimeout(90000,()=>session.destroy());});
 if(persistent)server.closeAllConnections=()=>{for(const session of sessions)session.destroy();};
 server.requestTimeout=180000;server.headersTimeout=15000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,hostname,resolve);});return server;
}
