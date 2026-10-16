// Isolated, loopback-only UI preview. No Docker access, controller token,
// production accounts, or persistent writes. Preview requests use memory only;
// real server-management actions are rejected. Optional creation/onboarding flows
// simulate success in memory only, for browser acceptance of those workflows.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const defaults=JSON.parse(await fs.readFile(path.join(project,'world-defaults.json'),'utf8'));
const snapshot={version:1,step:2,world:'Demo-factory.zip',seed:123456789,created:new Date().toISOString(),surface:'nauvis',chunks:[{x:0,y:0,tiles:[1,256],pollution:0}],palette:[{name:'grass-1',color:[80,110,55]}],entities:[],players:[{name:'Engineer',x:8,y:8,surface:'nauvis'}],tags:[],truncated:false};
const backups=[],schedule={enabled:false,hours:6,keep:12,lastRun:null};
const {summarizeBackups}=await import('../backup-health.js');
const status={version:'2.0.77',image:'factoriotools/factorio:2.0.77',currentWorld:snapshot.world,seed:String(snapshot.seed),running:true,ready:true,paused:true,players:[],playtime:'Demo snapshot',name:'Factory Control demo',schedule,autoPause:true,connection:'localhost:34197',autosaveMinutes:5,autosaveSlots:10,lastSaveAt:snapshot.created,saveVerified:true,memory:45000000,cpu:0};
const data={session:{username:'Preview',role:process.env.UI_ROLE||'admin',csrf:'isolated-preview',onboarding:{completed:process.env.UI_ONBOARDING_TEST!=='1'}},status,map:{snapshot,pins:[],staleWorld:false},jobs:{jobs:[],active:null},backups:{backups,schedule,health:summarizeBackups(backups,schedule,[],null)},accounts:{users:[{username:'Preview',role:'admin'}],invitations:[]},sessions:{sessions:[{id:'preview-session',created:new Date().toISOString(),expires:Date.now()+3600000,current:true}]}};
data.settings={name:'Isolated preview fixture',description:'Synthetic settings; cannot manage a real server.',max_players:0,autosave_interval:5,autosave_slots:10,auto_pause:true,require_user_verification:false};
data.updates={state:process.env.UI_RELEASE_TEST||'current',available:process.env.UI_RELEASE_TEST==='available',current:'0.1.0-alpha',channel:'preview',checkedAt:snapshot.created,installation:'manual',latest:process.env.UI_RELEASE_TEST==='available'?{tag:'v0.1.1-alpha',url:'https://github.com/jkenneydaniel/factorio-docker/releases/tag/v0.1.1-alpha'}:null};
data['update-status']={busy:false,jobs:[]};
data.map.automatic={enabled:true,pending:false,running:false,lastError:null};
data['world-options']={defaults,copied:{sourceWorld:snapshot.world,image:'factoriotools/factorio:2.0.77',created:snapshot.created,configuration:defaults},currentWorld:snapshot.world,image:'factoriotools/factorio:2.0.77'};
data.worlds={worlds:[{id:'demo-current',name:snapshot.world,relative:snapshot.world,current:true,kind:'active',modified:snapshot.created,size:1048576}]};
if(process.env.UI_POPULATED==='1'){
  status.players=['Daniel','Alex'];status.paused=false;status.name='Copper Coast';status.currentWorld='Copper Coast.zip';snapshot.world=status.currentWorld;status.playtime='12 hours';status.cpu=8.2;status.memory=1288490188;
  data.jobs.jobs=[['save','Save completed. The world is ready for your next session.'],['backup','Backup archive verified. Keep a copy on another device.'],['settings','Server settings updated. Autosave every 5 minutes.'],['start','Factorio 2.0.77 is ready.']].map(([action,message],i)=>({id:'fixture-'+i,action,message,state:'succeeded',started:new Date(Date.now()-(i+1)*60000).toISOString(),finished:new Date(Date.now()-(i+1)*60000).toISOString()}));
  const backup={relative:'Demo-backup.zip',modified:new Date(Date.now()-720000).toISOString(),size:24500000,validation:{ok:true,checked:snapshot.created}};backups.push(backup);data.backups.health=summarizeBackups(backups,schedule,[],null);
  data.logs={text:'Isolated UI fixture. No connection to a game server.\nFactorio 2.0.77 · Synthetic ready state.\nSaving finished (simulated).'};
  data.worlds.worlds=[{id:'demo-current',name:'Copper Coast',relative:'Copper Coast.zip',current:true,kind:'active',modified:snapshot.created,size:12400000},{id:'demo-archive',name:'Railway Island',relative:'panel-worlds/Railway Island.zip',current:false,kind:'archive',modified:snapshot.created,size:8900000},{id:'demo-autosave',name:'_autosave1',relative:'_autosave1.zip',current:false,kind:'autosave',modified:snapshot.created,size:12400000}];
}
if(process.env.UI_READY_TEST==='waiting'){status.ready=false;status.saveVerified=false;}

const fixtureImage=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#506e37"/><path d="M0 100Q250 350 512 100V220Q200 450 0 220Z" fill="#467889"/><text x="30" y="475" fill="white" font-size="20">Synthetic preview fixture</text></svg>');
let draftPreview=null,previewRequests=0;
let playerSample=0;
function previewPlayers(){playerSample++;return process.env.UI_LIVE_PLAYERS_TEST==='1'?{enabled:true,state:'live',world:snapshot.world,seed:snapshot.seed,updatedAt:new Date().toISOString(),players:[{name:'Preview engineer',x:playerSample*3,y:0,surface:snapshot.surface,color:[90,200,220]}]}:{enabled:false,state:'disabled',players:[]};}
if(process.env.UI_AUTO_REFRESH_TEST==='1')setTimeout(()=>{snapshot.created=new Date().toISOString();console.log('Preview-only snapshot advanced in memory.');},20000).unref();
http.createServer(async(req,res)=>{
  if(req.method==='GET'&&req.url==='/api/session'&&process.env.UI_AUTH_TEST==='login'){res.writeHead(401,{'content-type':'application/json'});return res.end('{"error":"Sign in to this isolated fixture."}');}
  if(req.method==='POST'&&req.url==='/api/registration'&&process.env.UI_AUTH_TEST==='login'){res.writeHead(200,{'content-type':'application/json'});return res.end('{"owner":true,"role":"admin"}');}
  if(req.method==='POST'&&req.url==='/api/world-preview'){let body='';for await(const chunk of req)body+=chunk;const value=JSON.parse(body);draftPreview={id:'fixture-'+(++previewRequests),seed:value.seed,state:'rendering'};setTimeout(()=>{if(draftPreview?.id==='fixture-'+previewRequests)draftPreview.state='ready';},150).unref();console.log(JSON.stringify({previewRequests,seed:value.seed,water:value.configuration.map_gen_settings.autoplace_controls.water.size}));res.writeHead(202,{'content-type':'application/json'});return res.end(JSON.stringify(draftPreview));}
  if(req.method==='POST'&&req.url==='/api/update-plan'&&process.env.UI_UPDATE_REVIEW_TEST==='1'){let body='';for await(const chunk of req)body+=chunk;const value=JSON.parse(body);res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({id:'synthetic-review-only',kind:value.kind,current:value.kind==='game'?'2.0.77':'0.1.0-alpha',target:value.target,impact:'SIMULATED REVIEW ONLY. No installation can run from this fixture.',backup:'A real installation would save and verify a backup.',notes:'Cancel this review to return.'}));}
  if(req.method==='POST'&&req.url==='/api/jobs'&&process.env.UI_CREATE_TEST==='1'){
    let body='';for await(const chunk of req)body+=chunk;const {action,params}=JSON.parse(body);
    if(action==='create'){
      const job={id:'fixture-create-'+Date.now(),action,state:'running',message:'Simulating world generation. No game files are created.',started:new Date().toISOString()};data.jobs.jobs.unshift(job);
      setTimeout(()=>{job.state='succeeded';job.finished=new Date().toISOString();job.message='Created '+params.name+' (isolated UI simulation). Current server world is unchanged.';data.worlds.worlds.push({id:job.id,name:params.name,relative:'panel-worlds/'+params.name+'.zip',kind:'archive',current:false,modified:job.finished,size:1234567});},300).unref();
      res.writeHead(202,{'content-type':'application/json'});return res.end(JSON.stringify(job));
    }
    res.writeHead(403,{'content-type':'application/json'});return res.end('{"error":"Only simulated library creation is enabled in this UI fixture."}');
  }
  if(req.method==='POST'&&req.url==='/api/onboarding'&&process.env.UI_ONBOARDING_TEST==='1'){data.session.onboarding={completed:true};res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify(data.session.onboarding));}
  if(req.method!=='GET'){res.writeHead(403,{'content-type':'application/json'});return res.end('{"error":"This isolated preview cannot change the real server or accounts."}');}
  const route=req.url.split('?')[0];if(route==='/api/world-preview-image'){res.writeHead(200,{'content-type':'image/svg+xml'});return res.end(fixtureImage);}
  if(route==='/api/world-preview'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify(draftPreview||{state:'idle'}));}
  if(route.startsWith('/api/')){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify(route==='/api/live-players'?previewPlayers():route==='/api/map-status'?{created:snapshot.created,automatic:data.map.automatic,active:null}:data[route.slice(5)]||{}));}
  const files={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/map.js':['map.js','text/javascript'],'/world-fields.js':['world-fields.js','text/javascript'],'/world-preview.js':['world-preview.js','text/javascript'],'/world-editor.js':['world-editor.js','text/javascript'],'/style.css':['style.css','text/css'],'/icons.js':['icons.js','text/javascript'],'/onboarding.js':['onboarding.js','text/javascript']};const file=files[route];if(!file){res.writeHead(404);return res.end();}res.writeHead(200,{'content-type':file[1]});res.end(await fs.readFile(path.join(project,'public',file[0])));
}).listen(Number(process.env.UI_PREVIEW_PORT||8089),'127.0.0.1',()=>console.log('Isolated UI fixture listening (no server-management access).'));
