// First-party vanilla bootstrap. Existing binaries and identities are never updated.
import fs from 'node:fs/promises';
import {writeFileSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createWebRcon} from './transport.js';
const check=(value,message)=>{if(!value)throw Error(message);};
export async function startup(env=process.env,root='/steamcmd/rust'){
 check(/^[A-Za-z0-9_-]{1,64}$/.test(env.RUST_SERVER_IDENTITY||''),'Invalid Rust identity');
 check(/^[A-Za-z0-9_-]{32,128}$/.test(env.RUST_RCON_PASSWORD||''),'A generated RCON password is required');
 check(!env.RUST_SERVER_STARTUP_ARGUMENTS||env.RUST_SERVER_STARTUP_ARGUMENTS==='-batchmode -nographics +server.secure 1 -logfile -','Custom startup commands require a reviewed migration');
 check(!['1','true'].includes(env.RUST_OXIDE_ENABLED),'Modified servers require a reviewed migration');
 check(await fs.realpath(root)===root,'Rust data root cannot be a link');
 const identity=path.join(root,'server',env.RUST_SERVER_IDENTITY);await fs.mkdir(path.join(identity,'cfg'),{recursive:true});
 for(const location of [path.join(root,'server'),identity,path.join(identity,'cfg')])check(await fs.realpath(location)===location,'Rust identity cannot be a link');
 const files=await fs.readdir(identity),saves=files.filter(name=>name.endsWith('.sav'));
 let seed=env.RUST_SERVER_SEED,size=env.RUST_SERVER_WORLDSIZE;
 const identities=new Set(saves.map(name=>name.match(/^proceduralmap\.(\d+)\.(\d+)\.\d+\.sav$/)).filter(Boolean).map(match=>match[1]+':'+match[2]));
 check(!saves.length||identities.size===1&&saves.every(name=>/^proceduralmap\.\d+\.\d+\.\d+\.sav$/.test(name)),'Existing save identity is ambiguous; no replacement world was generated');
 if(identities.size){const [savedSize,savedSeed]=[...identities][0].split(':');check(!seed||seed===savedSeed,'Configured seed differs from the existing world');check(!size||size===savedSize,'Configured size differs from the existing world');seed=savedSeed;size=savedSize;}
 seed??='12345';size??='2000';
 check(/^\d+$/.test(seed)&&Number(seed)>=1&&Number(seed)<=0xffffffff,'Invalid world seed');check(/^\d+$/.test(size)&&Number(size)>=1000&&Number(size)<=6000,'Invalid world size');
 const integer=(key,fallback)=>{const value=env[key]||fallback;check(/^\d+$/.test(value)&&Number(value)>=1024&&Number(value)<=65535,'Invalid port');return value;};
 const binary=path.join(root,'RustDedicated'),installed=await fs.lstat(binary).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 check(!installed||installed.isFile()&&await fs.realpath(binary)===binary,'Rust binary cannot be a link');
 // Never silently install a newer public game over an existing saved identity.
 const cloneMarker=path.join(root,'.lobby-goblin-clone.json'),clone=await fs.readFile(cloneMarker,'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 check(!clone||clone.game==='rust'&&clone.identity===env.RUST_SERVER_IDENTITY&&/^[a-f0-9]{32}$/.test(clone.snapshot),'Invalid independent clone marker');
 check(installed||!saves.length||clone,'Existing world has no installed game binary; recover its matching game installation first');
 const args=['-batchmode','-nographics','+server.identity',env.RUST_SERVER_IDENTITY,'+server.port',integer('RUST_SERVER_PORT','28015'),'+server.queryport',integer('RUST_SERVER_QUERYPORT','28017'),'+server.level',env.RUST_SERVER_LEVEL||'Procedural Map','+server.seed',seed,'+server.worldsize',size,'+rcon.port',integer('RUST_RCON_PORT','28016'),'+rcon.password',env.RUST_RCON_PASSWORD,'+rcon.web','1','+rcon.ip','0.0.0.0','+server.secure','1','-logfile','-'];
 return {binary,args,install:!installed,root,cloneMarker};
}
// Rust can terminate itself with SIGKILL after its own successful quit handler.
// Only accept that signal after this supervisor requested a save and observed
// both its completion and the game's explicit quit message in the current run.
export function shutdownEvidence(){
 const state={requested:false,saved:false,acknowledged:false,quit:false,quitting:false},tails=new Map();
 function line(value){if(/^Saving complete\s*$/.test(value))state.saved=true;if(state.quit&&/^\[Raknet\] Server Shutting Down \(quit\)\s*$/.test(value))state.quitting=true;}
 return {
  request(){Object.assign(state,{requested:true,saved:false,acknowledged:false,quit:false,quitting:false});tails.clear();},
  acknowledgeSave(response){state.acknowledged=true;if(String(response).split(/\r?\n/).some(value=>/^Saving complete\s*$/.test(value)))state.saved=true;},quit(){state.quit=true;},
  observe(chunk,stream='stdout'){if(!state.requested)return;const lines=((tails.get(stream)||'')+String(chunk)).split(/\r?\n/);tails.set(stream,lines.pop().slice(-4096));for(const value of lines)line(value);},
  evidence(){return {...state};},
  exitCode(code,signal){for(const tail of tails.values())line(tail);return code===0||signal==='SIGKILL'&&state.requested&&state.saved&&state.acknowledged&&state.quit&&state.quitting?0:1;}
 };
}
export function startupEvidence(){
 const tails=new Map();let complete=false;
 return {observe(chunk,stream='stdout'){const lines=((tails.get(stream)||'')+String(chunk)).split(/\r?\n/);tails.set(stream,lines.pop().slice(-4096));if(lines.some(line=>/^Server startup complete\s*$/.test(line)))complete=true;return complete;}};
}
const readyFile='/tmp/lobby-goblin-rust-ready.json';
async function run(file,args,options={}){return new Promise((resolve,reject)=>{const child=spawn(file,args,{stdio:'inherit',...options});child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolve():reject(Error('Rust preparation failed ('+(signal||code)+')')));});}
export async function main(){
 await fs.unlink(readyFile).catch(error=>{if(error.code!=='ENOENT')throw error;});
 const config=await startup();
 // Compatible old images ran as root. Normalize ownership without changing bytes.
 await run('chown',['-hR','1000:1000',config.root]);
 const user={uid:1000,gid:1000,cwd:config.root,env:{...process.env,HOME:'/home/node',LD_LIBRARY_PATH:config.root+':'+config.root+'/RustDedicated_Data/Plugins/x86_64'}};
 if(config.install)await run('/opt/steamcmd/steamcmd.sh',['+force_install_dir',config.root,'+login','anonymous','+app_update','258550','validate','+quit'],user);
 await fs.unlink(config.cloneMarker).catch(e=>{if(e.code!=='ENOENT')throw e;});
 const sdkCandidates=[path.join(config.root,'steamclient.so'),'/opt/steamcmd/linux64/steamclient.so'];
 for(const sdk of sdkCandidates)if(await fs.stat(sdk).catch(()=>null)){await fs.copyFile(sdk,'/home/node/.steam/sdk64/steamclient.so');await fs.chown('/home/node/.steam/sdk64/steamclient.so',1000,1000);break;}
 const child=spawn(config.binary,config.args,{...user,stdio:['ignore','pipe','pipe']}),rcon=createWebRcon(),shutdown=shutdownEvidence(),startupProof=startupEvidence();let stopping=false,healthy=false;
 for(const [stream,destination,key] of [[child.stdout,process.stdout,'stdout'],[child.stderr,process.stderr,'stderr']])stream.on('data',chunk=>{shutdown.observe(chunk,key);if(!healthy&&startupProof.observe(chunk,key)){writeFileSync(readyFile,JSON.stringify({pid:child.pid}),{mode:0o600});healthy=true;}destination.write(chunk);});
 process.on('SIGTERM',()=>{if(stopping)return;stopping=true;shutdown.request();void(async()=>{
  try{const saved=await rcon({host:'127.0.0.1',port:Number(process.env.RUST_RCON_PORT||28016),password:process.env.RUST_RCON_PASSWORD,command:'server.save'});shutdown.acknowledgeSave(saved);shutdown.quit();try{await rcon({host:'127.0.0.1',port:Number(process.env.RUST_RCON_PORT||28016),password:process.env.RUST_RCON_PASSWORD,command:'quit'});}catch{/* quit can close the socket before replying */}}
  catch{console.error('Rust is not ready for a graceful save; waiting for the process.');child.kill('SIGINT');}
 })();});
 child.once('error',()=>{console.error('Rust process could not start.');rcon.close();process.exitCode=1;});
 // close waits for stdout/stderr to drain, including the game's shutdown proof.
 child.once('close',(code,signal)=>{try{unlinkSync(readyFile);}catch{}console.log('Rust process exited: '+(signal||code));rcon.close();process.exitCode=shutdown.exitCode(code,signal);if(process.exitCode)console.error('Rust shutdown evidence: '+JSON.stringify(shutdown.evidence()));});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Rust startup refused. Check the installation and identity configuration.');process.exitCode=1;});
