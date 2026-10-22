import http from 'node:http';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {readBody,requestJSON,json,assert,HttpError,equalSecret} from '../common.js';
import {checkOrigin,checkPassword,requireAdmin,panelOrigin} from '../auth.js';
import {validateGameModule} from './game-module.js';
import {ReleaseChecks} from '../updates.js';
import {proxyResponse} from './proxy.js';
import {controllerRoutes} from './routes.js';
import {sharedAssets} from './web-assets.js';


export async function startWeb(module,{env=process.env,port=Number(env.PORT||8080),hostname='0.0.0.0',accounts:sharedAccounts,sessions:sharedSessions,controllerToken,listen=true,assetPrefix=''}={}){
  validateGameModule(module);
  const publicRoot=module.web.publicRoot||new URL('../public/',import.meta.url);
  const web=module.web;
  const {version:panelVersion}=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8'));
  const releases=new ReleaseChecks({current:panelVersion,repository:env.RELEASE_REPOSITORY||module.releaseRepository,channel:env.RELEASE_CHANNEL||'preview',enabled:env.RELEASE_CHECKS!=='false'});
  void releases.check();const releaseTimer=setInterval(()=>void releases.check(),6*3600000).unref();
  const authRoot=env.AUTH_DIR||'/auth';
  const accounts=sharedAccounts||new web.Accounts(authRoot);
  const token=controllerToken||(await fs.readFile(env.CONTROLLER_TOKEN_FILE||'/run/secrets/controller_token','utf8')).trim();
  const controller=env.CONTROLLER_URL||'http://panel-controller:8081';
  async function requireNoUpdate(){
    const result=await fetch(controller+'/update-status',{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(5000)});
    assert(result.ok,'Cannot confirm update state. Try again when the controller is ready.',503);
    assert(!(await result.json()).busy,'An update is in progress. Account changes are temporarily paused.',409);
  }
  const allowedHosts=(env.PANEL_HOSTS||'127.0.0.1,localhost').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  const origin=panelOrigin(env.PANEL_ORIGIN),secureCookie=origin?.startsWith('https:')?'; Secure':'';
  const sessions=sharedSessions||new Map(),attempts=new Map(),registrationAttempts=new Map();
  async function session(req){
    const id=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(web.sessionCookie+'='))?.slice(web.sessionCookie.length+1);
    const item=sessions.get(id);if(!item||item.expires<Date.now()){if(id)sessions.delete(id);return null;}
    const users=await accounts.users();
    if(!Object.hasOwn(users,item.username)||users[item.username].hash!==item.credentialHash){sessions.delete(id);return null;}
    return {...item,role:users[item.username].role,id};
  }
  function signedIn(res,username,record){
    const id=crypto.randomBytes(32).toString('base64url');
    const value={username,role:record.role,credentialHash:record.hash,sessionId:crypto.randomUUID(),created:new Date().toISOString(),csrf:crypto.randomBytes(32).toString('base64url'),expires:Date.now()+8*3600000};sessions.set(id,value);
    return json(res,200,{username,role:value.role,csrf:value.csrf,onboarding:record.onboarding||{completed:true}},{'set-cookie':`${web.sessionCookie}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureCookie}`});
  }
  const securityHeaders={
    'x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer',
    'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'permissions-policy':'camera=(), microphone=(), geolocation=()'
  };
  async function handle(req,res){
    for(const [key,value] of Object.entries(securityHeaders))res.setHeader(key,value);
    if(secureCookie)res.setHeader('strict-transport-security','max-age=31536000');
    if(req.url==='/health')return json(res,200,{ok:true});
    checkOrigin(req,allowedHosts,origin);const url=new URL(req.url,origin||`http://${req.headers.host}`);
    if(await web.dispatch?.(req,res,url,{session,accounts,sessions}))return;
    if(req.method==='POST'&&['/api/registration','/api/register'].includes(url.pathname)){
      const address=req.socket.remoteAddress,now=Date.now();
      let entry=registrationAttempts.get(address);if(!entry||entry.reset<now)entry={count:0,reset:now+600000};
      assert(entry.count<20,'Too many registration attempts. Try again in ten minutes.',429);
      entry.count++;registrationAttempts.set(address,entry);
      await requireNoUpdate();
      const body=await requestJSON(req);
      if(url.pathname==='/api/registration')return json(res,200,await accounts.inspect(body.token));
      const created=await accounts.register(body),users=await accounts.users();
      return signedIn(res,created.username,users[created.username]);
    }
    if(req.method==='POST'&&url.pathname==='/api/login'){
      const address=req.socket.remoteAddress,entry=attempts.get(address)||{count:0,reset:Date.now()+600000};
      if(entry.reset<Date.now()){entry.count=0;entry.reset=Date.now()+600000;}
      assert(entry.count<8,'Too many login attempts. Try again in ten minutes.',429);
      const body=await requestJSON(req);assert(typeof body.username==='string'&&typeof body.password==='string'&&body.password.length<=256,'Invalid login.',400);
      const users=await accounts.users(),user=users[body.username];
      if(!Object.hasOwn(users,body.username)||!checkPassword(body.password,user)){entry.count++;attempts.set(address,entry);throw new HttpError(401,'Username or password is incorrect.');}
      attempts.delete(address);return signedIn(res,body.username,user);
    }
    if(url.pathname.startsWith('/api/')){
      const user=await session(req);assert(user,'Please sign in.',401);
      if(req.method!=='GET'){if(!['/api/logout','/api/password','/api/sessions'].includes(url.pathname))requireAdmin(user);assert(equalSecret(req.headers['x-csrf-token'],user.csrf),'Session verification failed. Reload the page.',403);}
      if(req.method!=='GET'&&['/api/password','/api/accounts','/api/invitations','/api/onboarding'].includes(url.pathname))await requireNoUpdate();
      if(req.method==='GET'&&url.pathname==='/api/session')return json(res,200,{username:user.username,role:user.role,csrf:user.csrf,onboarding:await accounts.onboarding(user.username)});
      if(web.accountRoutes.includes(url.pathname))return web.handleAccount(req,res,url,{user,accounts,requireNoUpdate});
      if(url.pathname==='/api/diagnostics'){
        requireAdmin(user);assert(req.method==='GET','Not found.',404);
        let result=null;
        try{const response=await fetch(controller+'/diagnostics',{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12000)});if(response.ok)result=await response.json();}catch{}
        return json(res,200,web.diagnosticsReport(panelVersion,result));
      }
      if(url.pathname==='/api/onboarding'){
        requireAdmin(user);
        if(req.method==='GET')return json(res,200,await accounts.onboarding(user.username));
        assert(req.method==='POST','Not found.',404);const body=await requestJSON(req);assert(body.complete===true,'Confirm setup completion.');
        const response=await fetch(controller+'/status',{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(5000)});
        assert(response.ok,'The controller is unavailable. Retry when it is ready.',503);
        const value=await response.json();web.validateOnboarding(value);
        return json(res,200,await accounts.completeOnboarding(user.username));
      }
      if(url.pathname==='/api/updates/check'){requireAdmin(user);assert(req.method==='POST','Not found.',404);return json(res,200,await releases.check({force:true}),{'cache-control':'no-store'});}
      if(url.pathname==='/api/updates'){requireAdmin(user);assert(req.method==='GET','Not found.',404);void releases.check();return json(res,200,releases.result,{'cache-control':'no-store'});}
      if(req.method==='POST'&&url.pathname==='/api/logout'){sessions.delete(user.id);return json(res,200,{ok:true},{'set-cookie':`${web.sessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}`});}
      if(req.method==='POST'&&url.pathname==='/api/password'){
        const key='password:'+user.username,entry=attempts.get(key)||{count:0,reset:Date.now()+600000};
        if(entry.reset<Date.now()){entry.count=0;entry.reset=Date.now()+600000;}assert(entry.count<8,'Too many password attempts. Try again in ten minutes.',429);entry.count++;attempts.set(key,entry);
        const body=await requestJSON(req),record=await accounts.changePassword(user.username,body.currentPassword,body.password);
        attempts.delete(key);for(const [id,item] of sessions)if(item.username===user.username)sessions.delete(id);
        return signedIn(res,user.username,record);
      }
      if(url.pathname==='/api/sessions'){
        if(req.method==='GET')return json(res,200,{sessions:[...sessions.values()].filter(item=>item.username===user.username&&item.expires>Date.now()).map(item=>({id:item.sessionId,created:item.created,expires:item.expires,current:item.sessionId===user.sessionId}))});
        assert(req.method==='POST','Not found.',404);const body=await requestJSON(req);assert(body.others===true||typeof body.id==='string','Choose a session.');
        for(const [id,item] of sessions)if(item.username===user.username&&(body.others===true?id!==user.id:item.sessionId===body.id))sessions.delete(id);
        return json(res,200,{ok:true});
      }
      if(url.pathname==='/api/accounts'){
        requireAdmin(user);if(req.method==='GET')return json(res,200,await accounts.list());assert(req.method==='POST','Not found.',404);
        const body=await requestJSON(req),result=await accounts.update(body);
        for(const [id,item] of sessions)if(item.username===body.username)sessions.delete(id);return json(res,200,result);
      }
      if(url.pathname==='/api/invitations'){
        requireAdmin(user);assert(req.method==='POST','Not found.',404);const body=await requestJSON(req);
        if(body.revoke)return json(res,200,await accounts.revoke(body.revoke));
        return json(res,201,await accounts.invite(body.role,user.username));
      }
      const route=url.pathname.slice(4);
      assert(web.allowRoute?.(route)||controllerRoutes(module).includes(route),'Not found.',404);
      if(route.startsWith('/update-'))requireAdmin(user);
      if(['/download',...web.adminReadRoutes].includes(route))requireAdmin(user);
      let body;if(req.method==='POST'){
        body=await readBody(req,web.bodyLimit?.(route)||1024*1024);
        if(route==='/jobs'){let value;try{value=JSON.parse(body);}catch{throw new HttpError(400,'Invalid action.');}value.actor=user.username;body=Buffer.from(JSON.stringify(value));}
      }
      return proxyResponse(req,res,controller+route+url.search,{headers:{authorization:`Bearer ${token}`,'content-type':req.headers['content-type']||'application/json','x-panel-user':user.username},body,download:route==='/download',timeout:['/update-install','/mod-library','/mod-library-plan'].includes(route)?150000:30000});
    }
    const files={...sharedAssets,...web.assets};
    assert(req.method==='GET'&&Object.hasOwn(files,url.pathname),'Not found.',404);
    const [filename,type]=files[url.pathname];let content=await fs.readFile(new URL(filename,Object.hasOwn(web.assets,url.pathname)?publicRoot:new URL('../public/',import.meta.url)));
    if(assetPrefix){
      assert(/^(?:\/hosts\/[a-f0-9]{32})?\/servers\/[a-f0-9]{32}$/.test(assetPrefix),'Invalid server URL scope.');
      if(type.startsWith('text/html'))content=content.toString().replace(/(href|src)="\/(?!\/)/g,(_,key)=>key+'="'+assetPrefix+'/').replace(/<aside([^>]*)>/,'$&<a class="fleet-back" href="/">← All servers</a>');
      if(type.startsWith('text/css'))content=content.toString()+'\n.fleet-back{display:block;padding:10px 16px;color:#f4b861;text-decoration:none;font-size:14px}';
    }
    res.writeHead(200,{'content-type':type,'cache-control':'no-cache'});res.end(content);
  }
  const server=http.createServer((req,res)=>handle(req,res).catch(error=>{if(!res.headersSent)json(res,error.status||502,{error:error.status?error.message:'The controller is unavailable. Please try again.'});else res.destroy();}));
  server.requestTimeout=180000;server.headersTimeout=15000;if(listen)await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,hostname,resolve);});
  if(listen)console.log(module.name+' LAN panel listening on port '+server.address().port);
  const sessionTimer=setInterval(()=>{for(const map of [sessions,attempts,registrationAttempts])for(const [id,value] of map)if((value.expires||value.reset)<Date.now())map.delete(id);},60000).unref();
  server.once('close',()=>{clearInterval(releaseTimer);clearInterval(sessionTimer);});
  return server;
}
