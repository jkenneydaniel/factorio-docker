import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {hashPassword} from '../auth.js';
async function port(){const server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const result=server.address().port;await new Promise(r=>server.close(r));return result;}
test('authenticated diagnostics work when the controller is unreachable',{timeout:15000},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'factorio-offline-diagnostics-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const token=path.join(root,'token');await fs.writeFile(token,'test-controller-secret');await fs.writeFile(path.join(root,'users.json'),JSON.stringify({Owner:{...hashPassword('temporary test password'),role:'admin'}}));
  const origin='http://127.0.0.1:'+await port(),unreachable='http://127.0.0.1:'+await port();
  const panel=spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,MODE:'panel',PORT:new URL(origin).port,AUTH_DIR:root,CONTROLLER_URL:unreachable,CONTROLLER_TOKEN_FILE:token,PANEL_HOSTS:'127.0.0.1',RELEASE_CHECKS:'false'},stdio:'pipe'});
  t.after(async()=>{if(panel.exitCode===null&&panel.signalCode===null){const closed=new Promise(r=>panel.once('close',r));panel.kill();await closed;}});
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,25));}
  const login=await fetch(origin+'/api/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username:'Owner',password:'temporary test password'})});assert.equal(login.status,200);
  const headers={origin,cookie:login.headers.get('set-cookie').split(';')[0]};
  assert.equal((await fetch(origin+'/api/status',{headers})).status,502);
  const response=await fetch(origin+'/api/diagnostics',{headers});assert.equal(response.status,200);const report=await response.json();assert.equal(report.checks.find(c=>c.id==='controller').state,'error');assert.equal(report.checks.find(c=>c.id==='panel').state,'pass');
  assert.ok(!JSON.stringify(report).includes('test-controller-secret'));assert.ok(!JSON.stringify(report).includes(root));
});
