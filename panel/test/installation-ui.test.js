import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {welcomeView} from '../public/fleet/onboarding.js';

const base=new URL('../public/fleet/',import.meta.url),html=await fs.readFile(new URL('index.html',base),'utf8'),source=(await fs.readFile(new URL('app.js',base),'utf8')).replace(/^import .*;\r?\n/gm,'');
async function fixture({signedIn=false,completed=false,role='admin',invitation=false}={}){
  const nodes=new Map(),calls=[];let dispatching=true;
  const node=selector=>{
    if(!nodes.has(selector)){
      const tag=html.match(new RegExp('<[^>]*id="'+selector.slice(1)+'"[^>]*>'))?.[0]||'';
      nodes.set(selector,{hidden:/\bhidden\b/.test(tag),disabled:false,elements:new Proxy({},{get(target,key){return target[key]??={value:'',checked:false};}}),textContent:'',innerHTML:'',resetCount:0,reset(){this.resetCount++;},setAttribute(){},values:{token:'a'.repeat(43),username:'TestOwner',password:'isolated-ui-password',confirmPassword:'isolated-ui-password'}});
    }return nodes.get(selector);
  };
  const user=()=>({username:'TestOwner',role,csrf:'fixture-csrf',onboarding:{completed}});
  const fetch=async(route,options={})=>{
    const body=options.body?JSON.parse(options.body):undefined;calls.push({route,body});
    let data={},ok=true;
    if(route==='/api/session'){ok=signedIn;data=ok?user():{error:'Please sign in.'};}
    else if(route==='/api/registration')data={owner:role==='admin',role};
    else if(route==='/api/register'){dispatching=false;data=user();}
    else if(route==='/api/status')data={ready:true};
    else if(route==='/api/host-settings')data={memoryBudgetGiB:4,dockerMemoryGiB:16};
    else if(route==='/api/onboarding'){completed=true;data={completed:true};}
    else if(route==='/api/catalog')data={games:[]};
    else if(route==='/api/servers')data={servers:[]};
    else if(route==='/api/snapshots')data={snapshots:[]};
    else if(route==='/api/jobs')data={jobs:[],active:null};
    return {ok,json:async()=>data};
  };
  const context=vm.createContext({document:{querySelector:node,querySelectorAll:()=>[]},location:{origin:'http://localhost:8082',hash:invitation?'#register='+'a'.repeat(43):''},history:{replaceState(){}},welcomeView,fetch,setInterval(){},console,FormData:class{constructor(form){return Object.entries(form.values);}}});
  await vm.runInContext('(async()=>{'+source+'})()',context);
  return {node,calls,get completed(){return completed;},submit(){dispatching=true;const form=node('#register');return form.onsubmit({preventDefault(){},get currentTarget(){return dispatching?form:null;}});}};
}

test('first administrator registration reaches welcome after async form dispatch and does not finish setup automatically',async()=>{
  const f=await fixture({invitation:true});assert.equal(f.node('#login').hidden,true);assert.equal(f.node('#invitation-field').hidden,true);
  assert.equal(f.node('#auth-title').textContent,'Create your administrator account.');
  await f.submit();
  assert.equal(f.node('#register').resetCount,1);assert.equal(f.node('#error').hidden,true);
  assert.equal(f.node('#onboarding').hidden,false);assert.equal(f.node('#dashboard').hidden,true);assert.equal(f.completed,false);
  assert.equal(f.calls.filter(call=>call.route==='/api/onboarding').length,0);
  await f.node('#finish-installation').onclick();
  assert.equal(f.completed,true);assert.equal(f.node('#onboarding').hidden,true);assert.equal(f.node('#dashboard').hidden,false);
  assert.equal(f.calls.filter(call=>call.body&&call.route==='/api/servers').length,0,'Finishing setup must not create a game');
  await f.node('#logout').onclick();assert.equal(f.node('#login').hidden,false);assert.equal(f.node('#register').hidden,true);
});
test('password confirmation fails before account creation and keeps the registration form usable',async()=>{
  const f=await fixture({invitation:true});f.node('#register').values.confirmPassword='a different password';await f.submit();
  assert.equal(f.calls.filter(call=>call.route==='/api/register').length,0);
  assert.match(f.node('#error').textContent,/do not match/);assert.equal(f.node('#register-submit').disabled,false);assert.equal(f.node('#register').resetCount,0);
});
test('unfinished administrators resume welcome; established users and invited viewers go straight to their panel',async()=>{
  const pending=await fixture({signedIn:true});assert.equal(pending.node('#onboarding').hidden,false);assert.equal(pending.node('#dashboard').hidden,true);
  assert.ok(!pending.calls.some(call=>call.route==='/api/catalog'));
  const existing=await fixture({signedIn:true,completed:true});assert.equal(existing.node('#onboarding').hidden,true);assert.equal(existing.node('#dashboard').hidden,false);
  const viewer=await fixture({invitation:true,role:'viewer'});await viewer.submit();assert.equal(viewer.node('#onboarding').hidden,true);assert.equal(viewer.node('#dashboard').hidden,false);assert.equal(viewer.completed,false);
});
