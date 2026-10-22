import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {remoteGateway,startHostAgentWeb} from '../fleet/agent-web.js';
import {startFleetWeb} from '../fleet/web.js';

const origin='https://host.example.test',token='fixture-controller-token',peer='p'.repeat(43),serverId='c'.repeat(32);
async function listen(t,server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));return 'http://127.0.0.1:'+server.address().port;}

test('every remote POST gateway authenticates peers before consuming chunked or declared upload bodies',async t=>{
 let status=401,probes=0;
 const controller=await listen(t,http.createServer((req,res)=>{
  assert.equal(req.method,'GET');assert.equal(req.url,'/remote/v1/authorize');assert.equal(req.headers.authorization,'Bearer '+token);assert.equal(req.headers['x-host-token'],peer);probes++;res.writeHead(status);res.end();
 }));
 for(const transport of [undefined,'https','persistent'])for(const headers of [{'transfer-encoding':'chunked'},{'content-length':String(128*1024**2)}])for(const route of ['/servers/'+serverId+'/controller/upload?name=fixture.zip','/host-settings','/disconnect'])for(const denied of [401,503]){
  status=denied;let consumed=0;const before=probes;
  const req={method:'POST',headers:{authorization:'Bearer '+peer,...headers},socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){consumed++;throw Error('Request body was consumed before authentication.');}};
  const gateway=remoteGateway({env:{PANEL_ORIGIN:origin,AGENT_TRANSPORT:transport},controller,token});
  await assert.rejects(gateway(req,{},new URL('/remote/v1'+route,origin)),{status:denied===401?401:502});
  assert.equal(consumed,0);assert.equal(probes,before+1);
 }
});

test('hosted panels and legacy agents preserve authenticated chunked uploads and code pairing',async t=>{
 const uploads=[],pairings=[],probes=[];
 const controller=await listen(t,http.createServer(async(req,res)=>{
  assert.equal(req.headers.authorization,'Bearer '+token);
  if(req.url==='/remote/v1/authorize'){assert.equal(req.method,'GET');assert.equal(req.headers['x-host-token'],peer);probes.push(req.url);res.end('{}');return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
  if(req.url==='/remote/v1/pair'){assert.equal(req.headers['x-host-token'],'');pairings.push(JSON.parse(body));}
  else{assert.equal(req.headers['x-host-token'],peer);uploads.push(body);}
  res.setHeader('content-type','application/json');res.end('{"accepted":true}');
 }));
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'goblin-gateway-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'token');await fs.writeFile(file,token);
 const payload=Buffer.alloc(8192,7);
 for(const start of [startHostAgentWeb,startFleetWeb]){
  const edge=await start({hostname:'127.0.0.1',port:0,env:{PANEL_ORIGIN:origin,PANEL_HOSTS:'host.example.test',CONTROLLER_URL:controller,CONTROLLER_TOKEN_FILE:file,AUTH_DIR:path.join(root,'auth')}});
  t.after(()=>new Promise(resolve=>{edge.closeAllConnections();edge.close(resolve);}));
  const post=(route,body,paired)=>new Promise((resolve,reject)=>{
   const req=http.request('http://127.0.0.1:'+edge.address().port+'/remote/v1'+route,{method:'POST',headers:{host:'host.example.test',origin,'content-type':'application/json',...(paired?{authorization:'Bearer '+peer}:{})}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks))}));});req.on('error',reject);req.write(body.subarray(0,100));req.end(body.subarray(100));
  });
  assert.deepEqual(await post('/servers/'+serverId+'/controller/upload',payload,true),{status:200,body:{accepted:true}});
  assert.deepEqual(await post('/pair',Buffer.from('{"code":"fixture-pairing-code"}'),false),{status:200,body:{accepted:true}});
 }
 assert.equal(probes.length,2);assert.equal(uploads.length,2);for(const body of uploads)assert.deepEqual(body,payload);assert.equal(pairings.length,2);for(const value of pairings)assert.deepEqual(value,{code:'fixture-pairing-code'});
});
