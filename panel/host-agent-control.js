import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assert} from './common.js';

export async function hostAgentControl(args,{env=process.env,fetcher=fetch,log=console.log}={}){
 const [action,peerId]=args;assert(['pair','panels','revoke'].includes(action)&&args.length<=(action==='revoke'?2:1),'Use pair, panels, or revoke <panel-id>.');
 const token=(await fs.readFile(env.CONTROLLER_TOKEN_FILE||'/web-state/secrets/controller-token','utf8')).trim(),controller=env.CONTROLLER_URL||'http://127.0.0.1:8091';
 const body=action==='pair'?{operation:'create'}:action==='revoke'?{operation:'revoke',id:peerId}:undefined;
 const response=await fetcher(controller+'/host-pairing',{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(10000)});assert(response.ok,'The host agent could not complete this request.');const value=await response.json();
 if(action==='pair')log('Host address: '+env.FLEET_PANEL_URL+'\nPairing code: '+value.code+'\nExpires: '+new Date(value.expires).toISOString()+'\nIn your main panel, open Hosts → Add host. Keep this code private.');
 else if(action==='panels')log(value.panels.map(p=>p.id+'  '+p.name+'  '+p.centralId).join('\n')||'No panels are paired.');else log('Panel access revoked. Games and worlds were left unchanged.');return value;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))hostAgentControl(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
