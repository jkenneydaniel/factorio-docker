// Explicit acceptance against a disposable installation, never an existing panel.
// Run inside the isolated Ubuntu test host. State contains synthetic credentials
// and must stay in that disposable host; export only the printed result.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

assert.equal(process.env.GOBLIN_DISPOSABLE_ACCEPTANCE,'yes','Requires an explicitly disposable test installation.');
const [phase='initial',stateFile='/acceptance/http-state.json']=process.argv.slice(2);
assert.ok(['initial','persisted'].includes(phase));
const origin=new URL(process.env.ACCEPTANCE_ORIGIN||'http://localhost:8082');
const ca=process.env.ACCEPTANCE_CA?await fs.readFile(process.env.ACCEPTANCE_CA):undefined;
const checks=[];
function request(route,{body,cookie,csrf,requestOrigin=origin.origin}={}){
  return new Promise((resolve,reject)=>{
    const transport=origin.protocol==='https:'?https:http;
    const req=transport.request({hostname:'127.0.0.1',port:origin.port||(origin.protocol==='https:'?443:80),servername:origin.hostname,ca,path:route,method:body===undefined?'GET':'POST',headers:{host:origin.host,origin:requestOrigin,...(body===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{})}},res=>{
      let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text,json:()=>JSON.parse(text)}));
    });req.setTimeout(15000,()=>req.destroy(Error('Acceptance request timed out.')));req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
}
function status(response,expected){assert.equal(response.status,expected,response.text);return response;}
let state;
if(phase==='initial'){
  const invitation=await fs.readFile(process.env.ACCEPTANCE_INVITATION||'/acceptance/registration-link.txt','utf8');
  const link=new URL(invitation.match(/https?:\/\/[^\s]+\/\#register=[^\s]+/)[0]);
  assert.equal(link.origin,origin.origin);
  state={username:'InstallAcceptance',password:crypto.randomBytes(24).toString('base64url'),token:link.hash.slice('#register='.length)};
  const landing=status(await request('/'),200);assert.match(landing.text,/confirmPassword/);
  status(await request('/fleet-onboarding.js'),200);checks.push('registration page and onboarding asset served');
  status(await request('/api/status'),401);
  const inspection=status(await request('/api/registration',{body:{token:state.token}}),200).json();assert.equal(inspection.owner,true);
  const registered=status(await request('/api/register',{body:state}),200);
  const account=registered.json();assert.equal(account.role,'admin');assert.equal(account.onboarding.completed,false);
  const header=registered.headers['set-cookie'][0];assert.match(header,/HttpOnly/);assert.match(header,/SameSite=Strict/);
  assert.equal(header.includes('; Secure'),origin.protocol==='https:');
  if(ca)assert.match(registered.headers['strict-transport-security'],/31536000/);
  status(await request('/api/register',{body:state}),400);checks.push('one-time invitation and administrator registration');
  state.cookie=header.split(';')[0];state.csrf=account.csrf;
  const session={cookie:state.cookie,csrf:state.csrf};
  const host=status(await request('/api/host-settings',session),200).json();assert.equal(host.memoryBudgetGiB,2);assert.ok(host.dockerMemoryGiB>=4);
  const readiness=status(await request('/api/status',session),200).json();assert.equal(readiness.ready,true);
  status(await request('/api/onboarding',{body:{complete:true},cookie:state.cookie}),403);
  status(await request('/api/onboarding',{body:{complete:false},...session}),400);
  const completed=status(await request('/api/onboarding',{body:{complete:true},...session}),200).json();assert.equal(completed.completed,true);
  assert.equal(status(await request('/api/session',session),200).json().onboarding.completed,true);
  checks.push('real controller readiness, CSRF enforcement and explicit onboarding completion');
  status(await request('/api/logout',{body:{},...session}),200);
  status(await request('/api/session',session),401);checks.push('sign out invalidates session');
  await fs.writeFile(stateFile,JSON.stringify(state),{mode:0o600,flag:'wx'});
}else state=JSON.parse(await fs.readFile(stateFile,'utf8'));
const login=status(await request('/api/login',{body:{username:state.username,password:state.password}}),200);
assert.equal(login.json().onboarding.completed,true);
const session={cookie:login.headers['set-cookie'][0].split(';')[0],csrf:login.json().csrf};
assert.deepEqual(status(await request('/api/servers',session),200).json().servers,[]);
assert.deepEqual(status(await request('/api/snapshots',session),200).json().snapshots,[]);
if(phase==='persisted'){
  status(await request('/api/register',{body:{...state,username:'AnotherOwner'}}),400);
  checks.push('account and onboarding survive container recreation; consumed invitation stays invalid');
}
const hostileOrigin=origin.protocol==='https:'?'http://'+origin.host:'http://unrelated.example.com';
status(await request('/api/login',{body:{username:state.username,password:state.password},requestOrigin:hostileOrigin}),403);
checks.push('same-origin enforcement; no game servers or snapshots created');
console.log(JSON.stringify({phase,origin:origin.origin,checks},null,2));
