import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {httpsAddress,httpsGateway} from '../https.js';
import {optionsFor,installationFiles,prepareInstallation,readInstallation,main} from '../install.js';
import {prepareHostInstallation,readHostInstallation,hostInstallationFiles} from '../host-install.js';
import {setupInput,setupScript} from '../fleet/host-setup.js';
import {checkOrigin} from '../auth.js';
import {initializePanel} from '../init.js';
import {startFleetWeb} from '../fleet/web.js';

const version='0.3.5-alpha',ipv4='8.8.8.8',ipv6='2606:4700:4700::1111',id='d'.repeat(32);
const options=domain=>optionsFor({mode:'hosted',domain,address:'play.example.com'},version);
const config=compose=>JSON.parse(compose.configs['gateway-https'].content);
async function temporary(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'goblin-https-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}

test('HTTPS accepts public IPv4, IPv6 and DNS names and rejects private/reserved IPs and configuration injection',()=>{
 for(const address of [ipv4,ipv6,'games.example.com'])assert.equal(httpsAddress(address),address);
 assert.equal(httpsAddress('[2606:4700:4700:0:0:0:0:1111]'),ipv6);
 const privateV4=[[10,0,0,1],[172,16,1,2],[192,168,1,2]].map(octets=>octets.join('.'));
 for(const address of [...privateV4,undefined,null,123,'','localhost','games.local','GAMES.LOCAL','games.home.arpa','games.internal','https://example.com','example.com/path','example.com:8443','a\nb','example.com; command','${HOST}','0.0.0.0','100.64.0.1','127.0.0.1','169.254.1.2','192.0.2.1','198.18.1.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','999.1.2.3','::','::1','fc00::1','fe80::1','fe80::1%eth0','ff02::1','::ffff:8.8.8.8','2001:db8::1','3fff::1'])assert.throws(()=>httpsAddress(address),/HTTPS needs/,String(address));
});

test('new panel and agent plans explicitly automate Let’s Encrypt IP certificates with persistent storage and no-SNI support',()=>{
 for(const address of [ipv4,ipv6]){
  const o=options(address),panel=JSON.parse(installationFiles(o,'fixture',id)['install.compose.json']),agent=JSON.parse(hostInstallationFiles(o,id)['host.compose.json']);
  assert.equal(o.origin,address===ipv4?'https://'+address:'https://['+address+']');
  assert.ok(panel.services['fleet-web'].environment.PANEL_HOSTS.split(',').includes(new URL(o.origin).hostname));
  for(const [compose,upstream] of [[panel,'fleet-web:8080'],[agent,'host-agent:8080']]){
   const c=config(compose),policy=c.apps.tls.automation.policies[0];
   assert.deepEqual(c.apps.tls.certificates.automate,[address]);
   assert.deepEqual(policy.subjects,[address]);
   assert.deepEqual(policy.issuers,[{module:'acme',ca:'https://acme-v02.api.letsencrypt.org/directory',profile:'shortlived'}]);
   assert.equal(policy.renewal_window_ratio,0.5);
   assert.deepEqual(c.apps.http.servers.https.tls_connection_policies,[{default_sni:address}]);
   assert.equal(c.apps.http.servers.https.routes[0].handle[0].upstreams[0].dial,upstream);
   assert.deepEqual(c.apps.http.servers.https.routes[0].match,[{host:[address]}]);
   assert.equal(c.admin.disabled,true);assert.ok(!JSON.stringify(c).includes('"internal"'));
   assert.deepEqual(compose.services.gateway.command,['caddy','run','--config','/etc/caddy/lobby-goblin.json']);
   assert.deepEqual(compose.services.gateway.configs,[{source:'gateway-https',target:'/etc/caddy/lobby-goblin.json'}]);
   assert.ok(compose.services.gateway.volumes.includes('gateway-data:/data'));
   assert.deepEqual(compose.services.gateway.ports,['80:80/tcp','443:443/tcp']);
  }
 }
});

test('hostname HTTPS keeps Let’s Encrypt’s default profile; private local setup has no certificate gateway',()=>{
 const c=JSON.parse(httpsGateway('games.example.com','fleet-web:8080').definition['gateway-https'].content),policy=c.apps.tls.automation.policies[0];
 assert.equal(policy.issuers[0].profile,undefined);assert.equal(policy.renewal_window_ratio,undefined);
 assert.equal(policy.issuers[0].ca,'https://acme-v02.api.letsencrypt.org/directory');
 const local=JSON.parse(installationFiles(optionsFor({},version),'fixture',id)['install.compose.json']);
 assert.equal(local.services.gateway,undefined);assert.equal(local.configs,undefined);
});

test('IP HTTPS origins enforce exact hosts and same-origin mutations including bracketed IPv6',()=>{
 for(const address of [ipv4,ipv6]){
  const origin=options(address).origin,host=new URL(origin).host,req={method:'POST',headers:{host,origin}};
  checkOrigin(req,[new URL(origin).hostname],origin);
  assert.throws(()=>checkOrigin({...req,headers:{host,origin:'http://'+host}},[new URL(origin).hostname],origin),/origin/);
  assert.throws(()=>checkOrigin({...req,headers:{host:host+':8443',origin}},[new URL(origin).hostname],origin),/host/);
 }
});

test('SSH reviews accept IP agent addresses and a dedicated port without changing game addressing',async()=>{
 const input={name:'Host',host:'host.example.com',username:'root',memory:16,useSudo:false,installDocker:false};
 const v4=setupInput({...input,domain:ipv4},version);assert.equal(v4.options.address,ipv4);
 assert.equal(setupInput({...input,domain:'127.0.0.1',agentPort:25443},version).options.origin,'https://127.0.0.1:25443');
 const v6=setupInput({...input,domain:'['+ipv6+']'},version);assert.equal(v6.options.origin,'https://['+ipv6+']:24443');assert.equal(v6.options.address,input.host);
 assert.equal(setupInput({...input,domain:ipv6,address:'play.example.com'},version).options.address,'play.example.com');
 assert.throws(()=>setupInput({...input,host:ipv6,domain:ipv6},version),/game hostname or IPv4/);
 const script=await setupScript({...v6,id});assert.match(script,/'panel\/https.js'/);assert.match(script,new RegExp('--host \''+ipv6+'\''));
});

test('IP preparations write only isolated files and preserve their identity and certificate volume names on reruns',async t=>{
 const root=await temporary(t),directory=path.join(root,'panel');
 await main(['--prepare','--mode','hosted','--domain',ipv4,'--address',ipv4,'--directory',directory],{execute:()=>{throw Error('Must not contact Docker or issue certificates');},log:()=>{}});
 const panel=await readInstallation(directory),before=await fs.readFile(path.join(directory,'install.compose.json'),'utf8');
 assert.deepEqual(await prepareInstallation(directory,panel.options,{template:'unused'}),panel);assert.equal(await fs.readFile(path.join(directory,'install.compose.json'),'utf8'),before);
 const agentDir=path.join(root,'agent'),agent=await prepareHostInstallation(agentDir,options(ipv6)),agentBytes=await fs.readFile(path.join(agentDir,'host.compose.json'),'utf8');
 assert.deepEqual(await prepareHostInstallation(agentDir,options(ipv6)),agent);assert.equal(await fs.readFile(path.join(agentDir,'host.compose.json'),'utf8'),agentBytes);
 assert.equal((await readHostInstallation(agentDir)).options.origin,'https://['+ipv6+']');
});

test('existing hostname installation records and original gateway files remain valid and are never rewritten',async t=>{
 const root=await temporary(t),o=options('games.example.com');
 for(const agent of [false,true]){
  const directory=path.join(root,agent?'agent':'panel'),files=agent?hostInstallationFiles(o,id):installationFiles(o,'fixture',id),composeName=agent?'host.compose.json':'install.compose.json',recordName=agent?'host-installation.json':'installation.json';
  const compose=JSON.parse(files[composeName]);delete compose.configs;delete compose.services.gateway.configs;
  compose.services.gateway.command=['caddy','reverse-proxy','--from',o.domain,'--to',agent?'host-agent:8080':'fleet-web:8080'];
  files[composeName]=JSON.stringify(compose,null,2)+'\n';const record=JSON.parse(files[recordName]);record.files[composeName]=crypto.createHash('sha256').update(files[composeName]).digest('hex');files[recordName]=JSON.stringify(record,null,2)+'\n';
  await fs.mkdir(directory);for(const [name,content] of Object.entries(files))await fs.writeFile(path.join(directory,name),content);
  const read=agent?readHostInstallation:readInstallation;assert.deepEqual(await read(directory),record);
  if(agent)await prepareHostInstallation(directory,o);else await prepareInstallation(directory,o,{template:'unused'});
  for(const [name,content] of Object.entries(files))assert.equal(await fs.readFile(path.join(directory,name),'utf8'),content);
 }
});

for(const address of [ipv4,ipv6])test('administrator registration accepts the HTTPS IP origin and sets Secure cookies: '+address,async t=>{
 const root=await temporary(t),origin=options(address).origin,host=new URL(origin).host,{link}=await initializePanel(root,origin);
 const backend=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url==='/update-status'?{busy:false}:{ready:true}));});
 await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{backend.closeAllConnections();backend.close(resolve);}));
 const web=await startFleetWeb({env:{AUTH_DIR:path.join(root,'auth'),CONTROLLER_TOKEN_FILE:path.join(root,'secrets/controller-token'),CONTROLLER_URL:'http://127.0.0.1:'+backend.address().port,PANEL_HOSTS:new URL(origin).hostname,PANEL_ORIGIN:origin},port:0,hostname:'127.0.0.1'});
 t.after(()=>new Promise(resolve=>{web.closeAllConnections();web.close(resolve);}));
 const result=await new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port:web.address().port,path:'/api/register',method:'POST',headers:{host,origin,'content-type':'application/json'}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(text)}));});req.on('error',reject);
  req.end(JSON.stringify({token:link.split('=')[1],username:'IPOwner',password:'isolated-ip-https-password'}));
 });
 assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.role,'admin');assert.match(result.headers['set-cookie'][0],/; Secure/);assert.equal(result.headers['strict-transport-security'],'max-age=31536000');
});
