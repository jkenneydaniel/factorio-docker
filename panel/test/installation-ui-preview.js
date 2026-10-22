// Disposable browser fixture: fake host status, temporary accounts, no Docker
// socket, game storage or operational endpoints.
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {initializePanel} from '../init.js';
import {startFleetWeb} from '../fleet/web.js';
import {catalog} from '../fleet/catalog.js';
import {json} from '../common.js';
import {hashPassword} from '../auth.js';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'goblin-install-ui-'));
const {link}=await initializePanel(root,'http://localhost:8082');
const userFile=path.join(root,'auth/users.json'),state=JSON.parse(await fs.readFile(userFile,'utf8'));
state.users.InstallPreview={...hashPassword('isolated-install-ui-password'),role:'admin',onboarding:{completed:false}};
await fs.writeFile(userFile,JSON.stringify(state));
const secret=(await fs.readFile(path.join(root,'secrets/controller-token'),'utf8')).trim();
const backend=http.createServer((req,res)=>{
  if(req.headers.authorization!=='Bearer '+secret)return json(res,401,{error:'Unauthorized'});
  if(req.method!=='GET')return json(res,403,{error:'Game operations are unavailable in this isolated preview.'});
  const data={
    '/status':{ready:true,servers:0,activeJob:null},'/update-status':{busy:false},
    '/host-settings':{memoryBudgetGiB:4,dockerMemoryGiB:16,maxMemoryBudgetGiB:14,minMemoryBudgetGiB:2,hostHeadroomGiB:2,allocatedMemoryGiB:0,availableMemoryGiB:4,revision:0,allocations:[]},
    '/catalog':{games:Object.values(catalog)},'/servers':{servers:[]},'/snapshots':{snapshots:[]},'/jobs':{jobs:[],active:null},
  };return json(res,data[req.url]?200:404,data[req.url]||{error:'Unavailable in this isolated preview.'});
});
await new Promise(r=>backend.listen(0,'127.0.0.1',r));
const web=await startFleetWeb({env:{AUTH_DIR:path.join(root,'auth'),CONTROLLER_TOKEN_FILE:path.join(root,'secrets/controller-token'),CONTROLLER_URL:'http://127.0.0.1:'+backend.address().port,PANEL_HOSTS:'127.0.0.1,localhost'},port:0,hostname:'127.0.0.1'});
console.log(JSON.stringify({preview:'http://127.0.0.1:'+web.address().port+'/#register='+link.split('=')[1]}));
let closing=false;
async function cleanup(){if(closing)return;closing=true;web.closeAllConnections();backend.closeAllConnections();await Promise.all([new Promise(r=>web.close(r)),new Promise(r=>backend.close(r))]);await fs.rm(root,{recursive:true,force:true});}
process.on('SIGINT',()=>void cleanup().then(()=>process.exit()));process.on('SIGTERM',()=>void cleanup().then(()=>process.exit()));
