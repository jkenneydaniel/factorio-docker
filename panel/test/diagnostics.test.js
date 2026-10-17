import test from 'node:test';
import assert from 'node:assert/strict';
import {controllerDiagnostics,diagnosticsReport} from '../diagnostics.js';
const locations=[{id:'saves',title:'World storage',path:'/private/secret-worlds'}];
test('diagnostics issue metadata reads only and redact raw Docker, paths, worlds and errors by construction',async()=>{
  const calls=[],secret='never-share-this';
  const result=await controllerDiagnostics({version:'0.2.1-alpha',container:'test',locations,recentStatus:{ready:true},docker:async(method,route,body,options)=>{calls.push({method,route,body,options});return route==='/info'?{Architecture:'aarch64',Name:secret,Labels:[secret]}:{State:{Running:true},Config:{Env:['PASSWORD='+secret]},Mounts:[{Source:secret}]};},access:async()=>{},statfs:async()=>({bavail:1,bsize:4096})});
  assert.ok(calls.every(c=>c.method==='GET'&&c.body===undefined&&c.options.timeout===4000));
  assert.equal(result.checks.find(c=>c.id==='platform').state,'warning');assert.equal(result.checks.find(c=>c.id==='saves').state,'warning');assert.equal(result.checks.find(c=>c.id==='readiness').state,'pass');
  const report=JSON.stringify(diagnosticsReport('0.2.1-alpha',result));assert.ok(!report.includes(secret));assert.ok(!report.includes(locations[0].path));assert.ok(!report.includes('PASSWORD'));
});
test('missing Docker, stopped game, denied storage, and unknown readiness yield actionable partial results',async()=>{
  const result=await controllerDiagnostics({version:'0.2.1-alpha',container:'test',locations,docker:async(method,route)=>{if(route==='/info')throw new Error('secret socket path');return {State:{Running:false}};},access:async()=>{throw new Error('private user name');},statfs:async()=>{throw new Error('private disk');}});
  assert.equal(result.checks.find(c=>c.id==='docker').state,'error');assert.equal(result.checks.find(c=>c.id==='game').state,'warning');assert.equal(result.checks.find(c=>c.id==='readiness').state,'unknown');assert.equal(result.checks.find(c=>c.id==='saves').state,'error');assert.ok(!JSON.stringify(result).includes('private'));
  const offline=diagnosticsReport('0.2.1-alpha');assert.equal(offline.checks.find(c=>c.id==='controller').state,'error');assert.equal(offline.checks.find(c=>c.id==='panel').state,'pass');assert.equal(offline.checks.find(c=>c.id==='network').state,'manual');
});
test('a running container does not imply game readiness or known architecture',async()=>{
  const result=await controllerDiagnostics({container:'test',locations:[],docker:async(method,route)=>route==='/info'?{}:{State:{Running:true}}});
  assert.equal(result.checks.find(c=>c.id==='platform').state,'unknown');assert.equal(result.checks.find(c=>c.id==='readiness').state,'unknown');
});
test('Windows container mode explains that the game requires Linux containers',async()=>{
  const result=await controllerDiagnostics({container:'test',locations:[],docker:async(method,route)=>route==='/info'?{OSType:'windows',Architecture:'x86_64'}:{State:{Running:false}}});
  assert.equal(result.checks.find(c=>c.id==='docker').state,'error');assert.match(result.checks.find(c=>c.id==='docker').steps[0],/Linux containers/);
});
