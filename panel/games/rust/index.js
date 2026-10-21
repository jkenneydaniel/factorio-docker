import path from 'node:path';
import fs from 'node:fs/promises';
import {assert,HttpError} from '../../common.js';
import {Accounts} from '../../core/accounts.js';
import {createRust} from './controller.js';

export function rustConfiguration(env){
  const instance=env.RUST_INSTANCE_ID;
  assert(/^[a-f0-9]{32}$/.test(instance||''),'Prepare a separate Rust installation before selecting the Rust module.');
  assert(env.RUST_CONTAINER===`lobby-goblin-rust-${instance}`,'Rust container name must match its installation ID.');
  assert(/^didstopia\/rust-server@sha256:[a-f0-9]{64}$/.test(env.RUST_IMAGE||''),'Rust requires an explicitly selected didstopia/rust-server image digest.');
  assert(path.isAbsolute(env.RUST_HOST_DATA||''),'Rust requires its dedicated host data path.');
  const data=path.resolve(env.RUST_DATA||'/rust-server'),state=path.resolve(env.RUST_STATE_DIR||'/rust-state'),backups=path.resolve(env.RUST_BACKUPS_DIR||'/rust-backups');
  const roots=[data,state,backups];
  assert(roots.every(root=>root!=='/'&&!['/factorio','/backups','/state'].includes(root))&&roots.every((root,i)=>roots.every((other,j)=>i===j||root!==other&&!root.startsWith(other+'/'))),'Rust data, backups and controller state require separate dedicated directories.');
  return {managedVolume:env.FLEET_VOLUME||null,fleet:env.FLEET_ID||null,restartPolicy:env.FLEET_RESTART_POLICY||'unless-stopped',instance,container:env.RUST_CONTAINER,image:env.RUST_IMAGE,hostData:path.resolve(env.RUST_HOST_DATA),identity:'lobby-goblin-rust',data,state,backups,library:path.join(state,'unused-library'),backupDir:path.join(backups,'archives'),rconPort:28016,passwordFile:env.RUST_RCON_PASSWORD_FILE||'/run/secrets/rust_rcon_password'};
}
export async function validateInstallation(config){
  for(const root of [config.data,config.state,config.backups]){
    assert(await fs.realpath(root)===root,'Rust storage cannot use symbolic links.');
    const marker=JSON.parse(await fs.readFile(path.join(root,'.lobby-goblin-rust.json'),'utf8'));
    assert(marker.game==='rust'&&marker.instance===config.instance,'Rust storage belongs to a different installation.',409);
  }
}
function updater({current}){
  const status=()=>({current,busy:false,jobs:[],pendingRestore:null,supported:false,message:'Rust updates are managed separately. The Factorio updater is unavailable for this installation.'});
  const unavailable=async()=>{throw new HttpError(409,'Rust updates are managed separately; this installation cannot run the Factorio updater.');};
  return {current,jobs:[],busy:false,pendingRestore:null,init:async()=>{},refresh:async()=>status(),status,plan:unavailable,install:unavailable,restored:async()=>{}};
}
export const rust={
  id:'rust',name:'Rust',releaseRepository:'jkenneydaniel/lobby-goblin',stopTimeout:-1,
  routes:['/players','/logs','/settings'],configuration:rustConfiguration,validateInstallation,createController:createRust,createUpdater:updater,
  diagnostics:async()=>({game:'rust',checks:[],message:'Inspect Rust status and logs for readiness.'}),
  web:{Accounts,sessionCookie:'rust_session',accountRoutes:[],adminReadRoutes:['/logs','/settings'],
    assets:{'/scope.js':['scope.js','text/javascript; charset=utf-8'],'/':['rust/index.html','text/html; charset=utf-8'],'/app.js':['rust/app.js','text/javascript; charset=utf-8'],'/style.css':['rust/style.css','text/css; charset=utf-8']},
    diagnosticsReport:(version,controller)=>({version,controller}),validateOnboarding:value=>assert(value.ready,'Wait for Rust to become ready.',409)},
};
