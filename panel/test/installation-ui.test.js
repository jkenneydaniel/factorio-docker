import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createApi} from '../public/client.js';
import {createSessionController} from '../public/shared/session.js';
import {createEventScope} from '../public/shared/events.js';

// The auth controller is the tested boundary. Full entrypoint and welcome-screen
// integration is covered by the isolated browser suite, rather than stripping
// imports from an entire application and duplicating all of its dependencies.
const source=(await fs.readFile(new URL('../public/fleet/auth.js',import.meta.url),'utf8')).replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/^export /gm,'');
async function fixture({signedIn=false,completed=false,role='admin',invitation=false}={}){
  const nodes=new Map(),calls=[];let dispatching=true,authenticated=0,loads=0,signedOut=0;
  function node(selector){
    if(!nodes.has(selector))nodes.set(selector,{hidden:false,disabled:false,textContent:'',resetCount:0,handlers:new Map(),elements:{token:{value:''}},values:{token:'a'.repeat(43),username:'TestOwner',password:'isolated-ui-password',confirmPassword:'isolated-ui-password'},
      reset(){this.resetCount++;},addEventListener(type,handler){this.handlers.set(type,handler);},removeEventListener(type,handler){if(this.handlers.get(type)===handler)this.handlers.delete(type);},
    });return nodes.get(selector);
  }
  const user=()=>({username:'TestOwner',role,csrf:'fixture',onboarding:{completed}});
  const request=createApi({getSession:()=>session.current,fetcher:async(route,options={})=>{
    const body=options.body?JSON.parse(options.body):undefined;calls.push({route,body});
    let data={},status=200;
    if(route==='/api/session'){status=signedIn?200:401;data=signedIn?user():{error:'Please sign in.'};}
    if(route==='/api/registration')data={owner:role==='admin',role};
    if(route==='/api/register'){dispatching=false;data=user();}
    return {ok:status===200,status,json:async()=>data};
  }}),session=createSessionController({request});
  const context=vm.createContext({createEventScope,AbortController,document:{querySelector:node},location:{hash:invitation?'#register='+'a'.repeat(43):''},history:{replaceState(){}},FormData:class{constructor(form){return Object.entries(form.values);}}});
  const create=vm.runInContext(source+'\ncreateFleetAuth;',context);
  const auth=create({sessionController:session,request,error:message=>{node('#error').textContent=message;node('#error').hidden=!message;},authenticated:()=>{authenticated++;},load:async()=>{loads++;},onSignedOut:()=>{signedOut++;}});
  await auth.bootstrap();
  async function fire(selector,type){const form=node(selector);form.handlers.get(type)({preventDefault(){},get currentTarget(){return dispatching?form:null;}});await new Promise(resolve=>setImmediate(resolve));}
  return {node,calls,session,get authenticated(){return authenticated;},get loads(){return loads;},get signedOut(){return signedOut;},submit:async()=>{dispatching=true;await fire('#register','submit');},logout:async()=>{dispatching=true;await fire('#logout','click');}};
}

test('first administrator registration captures the form before async dispatch and preserves unfinished onboarding',async()=>{
  const f=await fixture({invitation:true});assert.equal(f.node('#login').hidden,true);assert.equal(f.node('#invitation-field').hidden,true);assert.equal(f.node('#auth-title').textContent,'Create your administrator account.');
  await f.submit();assert.equal(f.node('#register').resetCount,1);assert.equal(f.node('#error').textContent,'');assert.equal(f.session.current.onboarding.completed,false);assert.equal(f.loads,1);assert.equal(f.calls.filter(call=>call.route==='/api/onboarding').length,0);
  await f.logout();assert.equal(f.session.current,null);assert.equal(f.signedOut,1);assert.equal(f.node('#login').hidden,false);assert.equal(f.node('#register').hidden,true);
});
test('password confirmation fails before account creation and keeps the registration form usable',async()=>{
  const f=await fixture({invitation:true});f.node('#register').values.confirmPassword='a different password';await f.submit();assert.equal(f.calls.filter(call=>call.route==='/api/register').length,0);assert.match(f.node('#error').textContent,/do not match/);assert.equal(f.node('#register-submit').disabled,false);assert.equal(f.node('#register').resetCount,0);assert.equal(f.loads,0);
});
test('bootstrap preserves pending and completed onboarding and invited viewers bypass session bootstrap',async()=>{
  const pending=await fixture({signedIn:true});assert.equal(pending.session.current.onboarding.completed,false);assert.equal(pending.loads,1);
  const existing=await fixture({signedIn:true,completed:true});assert.equal(existing.session.current.onboarding.completed,true);assert.equal(existing.loads,1);
  const viewer=await fixture({invitation:true,role:'viewer'});assert.ok(!viewer.calls.some(call=>call.route==='/api/session'));await viewer.submit();assert.equal(viewer.session.current.role,'viewer');assert.equal(viewer.session.current.onboarding.completed,false);assert.equal(viewer.loads,1);
});
