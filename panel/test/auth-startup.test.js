import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// Run each real entry point against a delayed session response. Unrelated
// server-data loading is stubbed so these tests exercise authentication alone.
for (const variant of [
  {dir:'', auth:'login-view', shell:'app-view'},
  {dir:'rust/', auth:'auth', shell:'shell'},
  {dir:'fleet/', auth:'auth', shell:'dashboard'},
]) {
  async function fixture(hash='') {
    const base=new URL('../public/'+variant.dir,import.meta.url);
    const html=await fs.readFile(new URL('index.html',base),'utf8');
    const source=await fs.readFile(new URL('app.js',base),'utf8');
    const nodes=new Map();
    const node=selector=>{
      if(!nodes.has(selector)){
        const tag=html.match(new RegExp('<[^>]*id="'+selector.slice(1)+'"[^>]*>'))?.[0]||'';
        const elements=new Proxy({}, {get(target,key){return target[key]??=( {value:'',checked:false} );}});
        nodes.set(selector,{hidden:/\bhidden\b/.test(tag),elements,dataset:{},classList:{toggle(){},remove(){}},addEventListener(){},reset(){},querySelector:node});
      }
      return nodes.get(selector);
    };
    let settle,fail;
    const response=new Promise((resolve,reject)=>{settle=resolve;fail=reject;});
    const document={querySelector:node,querySelectorAll:()=>[]};
    const context=vm.createContext({document,location:{hash,pathname:'/',origin:'http://test'},history:{replaceState(){}},
      URLSearchParams,console,fetch:route=>String(route).endsWith('/session')?response:Promise.resolve({ok:true,json:async()=>({role:'admin'})}),
      serverPath:value=>value,icon:()=>'',cleanWorldPreview(){},clearWorldDraft(){},addEventListener(){},clearInterval(){},setInterval(){},setTimeout(){}});
    const boot=vm.runInContext('(async()=>{'+source.replace(/^import .*;\r?\n/gm,'')+'\nasync function navigate(){}\nasync function load(){}\nasync function refresh(){}\n})()',context);
    return {node,boot,settle,fail};
  }
  for(const outcome of ['signed-in','signed-out','network-error'])test(`${variant.dir||'factorio/'} waits for session before showing sign-in (${outcome})`,async()=>{
    const {node,boot,settle,fail}=await fixture();
    assert.equal(node('#'+variant.auth).hidden,true,'sign-in must be hidden in initial HTML');
    assert.equal(node('#'+variant.shell).hidden,true,'protected UI must start hidden');
    assert.equal(node('#session-loading').hidden,false);
    if(outcome==='network-error')fail(Error('Connection lost'));
    else settle({ok:outcome==='signed-in',status:401,json:async()=>({username:'Engineer',role:'admin',csrf:'test'})});
    await boot;
    assert.equal(node('#session-loading').hidden,true);
    assert.equal(node('#'+variant.auth).hidden,outcome==='signed-in');
    assert.equal(node('#'+variant.shell).hidden,outcome!=='signed-in');
  });
  if(variant.dir!=='fleet/')test(`${variant.dir||'factorio/'} invitation opens registration without waiting for a session`,async()=>{
    const {node,boot}=await fixture('#register=fixture-token');await boot;
    assert.equal(node('#session-loading').hidden,true);
    assert.equal(node('#'+variant.auth).hidden,false);
    assert.equal(node('#'+variant.shell).hidden,true);
  });
}
