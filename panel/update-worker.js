// Detached from the services it replaces. No HTTP listener or arbitrary commands.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assert,readJSON,writeJSON,sleep,redact} from './common.js';
import {sourceSnapshot,assertUnmodified,unpackRelease,setEnvironment,daemonPath} from './update-source.js';
import {gameUpdate,gameSources} from './public/game-images.js';

export function commandFailure(args,{output='',code=null,signal=null,timedOut=false,exceeded=false}={}){
  const operation=args[0]==='compose'?'Docker Compose':'Docker '+args[0];
  const details=redact(output).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'')
    .replace(/https?:\/\/[^\s/]+@/gi,'https://[redacted]@')
    .replace(/\bBearer\s+[^\s"']+/gi,'Bearer [redacted]')
    .replace(/([?&](?:token|key|password|secret|signature)=)[^&\s"']+/gi,'$1[redacted]')
    .replace(/\b((?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*)[^\s,"']+/gi,'$1[redacted]')
    .slice(-8192);
  const cause=timedOut?'timed out':exceeded?'exceeded its output limit':/x509:|failed to verify certificate/i.test(details)?'could not verify the registry HTTPS certificate; check the updater image CA certificate bundle':'failed'+(code===null?'':` (exit ${code})`);
  const error=new Error(`${operation} ${cause}. Details are retained in the update failure record.`);
  error.diagnostic={operation,exitCode:code,signal,timedOut,outputLimit:exceeded,output:details};
  return error;
}

export function command(args,{cwd,timeout=15*60000,spawnProcess=spawn}={}){
  return new Promise((resolve,reject)=>{
    const grouped=process.platform!=='win32';
    const child=spawnProcess('docker',args,{cwd,detached:grouped,env:{...process.env,DOCKER_HOST:'unix:///var/run/docker.sock',DOCKER_CONFIG:'/tmp/factory-control-docker'},stdio:['ignore','pipe','pipe']});
    const stop=()=>{try{if(grouped&&child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}};
    let output='',exceeded=false,timedOut=false,received=0;
    for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{received+=chunk.length;output=(output+chunk.toString()).slice(-8*1024*1024);if(received>8*1024*1024&&!exceeded){exceeded=true;stop();}});
    const timer=setTimeout(()=>{timedOut=true;stop();},timeout);
    child.on('error',error=>{clearTimeout(timer);reject(commandFailure(args,{output:error.code||'Could not start the Docker client.'}));});
    child.on('close',(code,signal)=>{clearTimeout(timer);code===0&&!exceeded&&!timedOut?resolve(output):reject(commandFailure(args,{output,code,signal,timedOut,exceeded}));});
  });
}
export async function download(url,limit,fetcher=fetch){
  const parsed=new URL(url);assert(parsed.protocol==='https:'&&parsed.hostname==='github.com'&&/^\/[^/]+\/[^/]+\/releases\/download\//.test(parsed.pathname),'Invalid release download.');
  const res=await fetcher(url,{signal:AbortSignal.timeout(120000),redirect:'follow'});
  assert(res.ok,'Release download failed. Try again when GitHub is available.');
  let size=0;const chunks=[];for await(const chunk of res.body){size+=chunk.length;assert(size<=limit,'Release download is too large.');chunks.push(chunk);}return Buffer.concat(chunks);
}
function mountSignature(service){return JSON.stringify((service.volumes||[]).map(v=>({type:v.type,source:v.type==='bind'?daemonPath(v.source):v.source,target:v.target,read_only:!!v.read_only})).sort((a,b)=>a.target.localeCompare(b.target)));}
export function validateDeployment(before,after,job){
  for(const [service,key] of [['factorio','game'],['panel-controller','controller'],['panel','panel']]){
    const a=before.services?.[service],b=after.services?.[service];
    assert(a&&b&&a.container_name===job.names[key]&&b.container_name===a.container_name,'Release changes the managed container identities. Use a reviewed host upgrade.');
    assert(mountSignature(a)===mountSignature(b)&&JSON.stringify(a.ports||[])===JSON.stringify(b.ports||[]),'Release changes persistent mounts or published ports. Use a reviewed host upgrade.');
  }
  assert(after.services.factorio.platform==='linux/amd64','Updates must preserve the game architecture policy.');
  assert(job.kind!=='panel'||after.services.factorio.image===job.gameImage,'Panel updates cannot change the game image.');
  if(job.kind==='game')assert(JSON.stringify({...before.services.factorio,image:null})===JSON.stringify({...after.services.factorio,image:null}),'Game image changes must preserve all existing settings, mounts, ports and startup options.');
  assert(Object.keys(after.services).every(s=>['factorio','panel-controller','panel','setup'].includes(s)),'Release introduces unsupported services. Use a reviewed host upgrade.');
}
export function reportsGameVersion(output,target){return output.trim()===target||new RegExp('^Version:\\s*'+target.replaceAll('.','\\.')+'(?:\\s|$)','m').test(output);}
export function gameImageProbe(image){return ['run','--rm','--platform','linux/amd64','--pull','never','--network','none','--read-only','--tmpfs','/tmp:rw,nosuid,size=16m','--user','845:845','--entrypoint','/bin/sh',image,'-ec','test -x /docker-entrypoint.sh; command -v rcon >/dev/null; /opt/factorio/bin/x64/factorio --version'];}
export async function inspectGameImage(image,run=command){
  let item=JSON.parse(await run(['image','inspect',image]))[0];
  // Classic Docker stores already return the pulled amd64 config. Newer
  // multi-platform stores may return an index or the host's native variant.
  if(item?.Os!=='linux'||item.Architecture!=='amd64'||!item.Config?.Entrypoint)item=JSON.parse(await run(['image','inspect','--platform','linux/amd64',image]))[0];
  assert(item?.Os==='linux'&&item.Architecture==='amd64','The selected image must support linux/amd64.');
  return item;
}
export function validateGameImage(item,selection){
  assert(item?.Os==='linux'&&item.Architecture==='amd64'&&/^sha256:[a-f0-9]{64}$/.test(item.Id),'The selected image must support linux/amd64.');
  const config=item.Config||{},labels=config.Labels||{},repository=gameSources[selection.source].repository;
  assert(labels['factorio.version']===selection.target,'The image does not declare the reviewed Factorio version.');
  assert(JSON.stringify(config.Entrypoint)===JSON.stringify(['/docker-entrypoint.sh']),'The image has an incompatible startup entrypoint.');
  assert(config.Volumes&&Object.hasOwn(config.Volumes,'/factorio'),'The image must preserve /factorio storage.');
  const env=new Set(config.Env||[]);
  assert(['PUID=845','PGID=845','SAVES=/factorio/saves','CONFIG=/factorio/config','MODS=/factorio/mods','SCENARIOS=/factorio/scenarios','SCRIPTOUTPUT=/factorio/script-output','PORT=34197','RCON_PORT=27015'].every(v=>env.has(v)),'The image has incompatible data paths, permissions or ports.');
  assert(Object.hasOwn(config.ExposedPorts||{},'34197/udp')&&Object.hasOwn(config.ExposedPorts||{},'27015/tcp'),'The image has incompatible exposed ports.');
  if(selection.source==='factory')assert(labels['io.factory-control.compatibility']==='1'&&labels['io.factory-control.image-revision']===String(selection.imageRevision),'The Factory Control image compatibility or revision does not match the review.');
  return repository;
}
export function compatibleGameImage(item,selection){
  const repository=validateGameImage(item,selection);
  const digest=(item.RepoDigests||[]).find(value=>value.startsWith(repository+'@sha256:')&&/^[a-f0-9]{64}$/.test(value.slice((repository+'@sha256:').length)));
  assert(digest,'The image has no verifiable repository digest.');
  return selection.targetImage+'@'+digest.split('@')[1];
}
async function copyTree(from,to){
  async function safe(file){const stat=await fs.lstat(file);assert(!stat.isSymbolicLink(),'Recovery state contains a symlink.');if(stat.isDirectory())for(const name of await fs.readdir(file))await safe(path.join(file,name));else assert(stat.isFile(),'Recovery state contains a special file.');}
  await safe(from);await fs.cp(from,to,{recursive:true,preserveTimestamps:true});
}
export async function runUpdate({root,state,id,run=command,fetcher=fetch,wait=sleep,now=Date.now,own=async file=>{if(process.getuid?.()===0)await fs.chown(file,845,845);}}){
  assert(/^[0-9a-f-]{36}$/.test(id),'Invalid update job.');
  const file=path.join(state,id+'.json'),job=await readJSON(file,null);
  assert(job&&job.id===id&&job.root===root&&job.state==='running','Update job is unavailable.');
  const recovery=path.join(state,id),stage=path.join(recovery,'stage');
  const compose=(...args)=>run(['compose','--project-directory',root,'--env-file',path.join(root,'.env'),'-p',job.project,'-f',path.join(root,'compose.yaml'),...args],{cwd:root});
  const phase=async(message,status='running')=>{job.message=message;job.state=status;await writeJSON(file,job);await own(file);};
  const save=async()=>{await writeJSON(file,job);await own(file);};
  let oldEnv,oldFiles,configBefore,changed=false,sourcePromoted=false,applied=false;
  const writeOwned=async(name,data)=>{
    const target=path.join(root,name),original=await fs.lstat(target).catch(()=>null),rootOwner=await fs.stat(root),owner=original||rootOwner;
    assert(!original||original.isFile(),'Refusing a non-file source destination.');
    let parent=root;
    for(const part of name.split('/').slice(0,-1)){
      parent=path.join(parent,part);const stat=await fs.lstat(parent).catch(()=>null);assert(!stat||stat.isDirectory(),'Refusing a symlink or special source directory.');
      if(!stat){await fs.mkdir(parent);if(process.getuid?.()===0)await fs.chown(parent,rootOwner.uid,rootOwner.gid);}
    }
    await fs.writeFile(target,data,{mode:original?.mode&0o777||(/\.(?:sh|command)$/.test(name)?0o755:0o644)});
    if(process.getuid?.()===0)await fs.chown(target,owner.uid,owner.gid);
  };
  async function restoreSource(){
    const current=await sourceSnapshot(root);
    for(const name of Object.keys(current))if(!Object.hasOwn(oldFiles,name))await fs.unlink(path.join(root,name));
    for(const name of Object.keys(oldFiles))await writeOwned(name,await fs.readFile(path.join(recovery,'source',name)));
    await writeOwned('.env',oldEnv);
  }
  try{
    assert((await fs.lstat(path.join(root,'.env'))).isFile(),'Updates require an ordinary .env file.');
    await assertUnmodified(root,await readJSON(path.join(state,'baseline.json'),null));
    // Check identities again in the surviving worker, before pulling or replacing.
    for(const [key,name] of Object.entries(job.names)){
      const current=JSON.parse(await run(['inspect',name]));
      assert(current[0]?.Image===job.images[key],'Installed containers changed after review. No update was applied.');
    }
    oldEnv=await fs.readFile(path.join(root,'.env'),'utf8');oldFiles=await sourceSnapshot(root);
    await fs.mkdir(stage,{recursive:true,mode:0o700});await fs.chmod(recovery,0o700);
    for(const name of Object.keys(oldFiles)){const target=path.join(recovery,'source',name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(root,name),target);}
    await fs.writeFile(path.join(recovery,'before.env'),oldEnv,{mode:0o600});
    // Recover panel state only; never roll the game save back silently.
    for(const name of ['auth','controller','secrets'])await copyTree(path.join(root,'.panel-data',name),path.join(recovery,name));
    job.recovery={backup:job.backup,directory:'.panel-data/updates/'+id,action:'Recovery copies retained. No world restore is performed automatically.'};await save();
    const envPinned=setEnvironment(oldEnv,'FACTORIO_IMAGE',job.gameImage);
    configBefore=JSON.parse(await compose('config','--format','json'));
    if(job.kind==='panel'){
      await phase('Downloading and verifying the panel release…');
      const metadata=JSON.parse((await download(job.assets['.update.json'],65536,fetcher)).toString());
      const checksum=(await download(job.assets['.sha256'],1024,fetcher)).toString();
      const archive=await download(job.assets['.zip'],32*1024*1024,fetcher);
      const files=unpackRelease(archive,checksum,job.target,metadata);
      for(const [name,data] of files){const target=path.join(stage,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,data);}
      await phase('Building the verified release. Your game keeps running…');
      const image='local/factory-control:update-'+id;
      await run(['build','--progress=plain','--tag',image,path.join(stage,'panel')],{cwd:root});
      // Local edits that arrive while the image builds must also block promotion.
      await assertUnmodified(root,{format:1,files:oldFiles});
      assert(await fs.readFile(path.join(root,'.env'),'utf8')===oldEnv,'Installation settings changed while building. No source was replaced.');
      changed=true;sourcePromoted=true;
      for(const name of Object.keys(oldFiles))if(!files.has(name))await fs.unlink(path.join(root,name));
      for(const [name,data] of files)await writeOwned(name,data);
      await writeOwned('.env',setEnvironment(envPinned,'PANEL_IMAGE',image));
      const after=JSON.parse(await compose('config','--format','json'));validateDeployment(configBefore,after,job);
      await phase('Replacing the panel and controller. Reconnect when sign-in returns…');applied=true;
      await compose('up','-d','--no-deps','--no-build','--pull','never','--wait','--wait-timeout','120','panel-controller','panel');
      for(const name of [job.names.controller,job.names.panel]){
        const item=JSON.parse(await run(['inspect',name]))[0];assert(item?.State?.Health?.Status==='healthy','Updated panel services did not become healthy.');
      }
      assert(JSON.parse(await run(['inspect',job.names.game]))[0].Image===job.images.game,'Unexpected game image change.');
      const baseline=path.join(state,'baseline.json');await writeJSON(baseline,{format:1,files:await sourceSnapshot(root)});await own(baseline);
      await phase('Panel and controller updated. Sign in again; the game was not restarted.','succeeded');
    }else{
      assert(job.kind==='game','Unsupported update target.');
      const selection=gameUpdate(job.gameImage,job),image=selection.targetImage;
      assert(!job.targetImage||job.targetImage===image,'The image does not match the reviewed source and revision.');
      assert(configBefore.services.factorio.image===job.gameImage,'Configured game image changed after review. No containers were replaced.');
      await phase('Downloading the selected Factorio version…');await run(['pull','--platform','linux/amd64',image]);
      const candidate=await inspectGameImage(image,run),pinned=compatibleGameImage(candidate,selection);
      // This disposable probe has no host mounts, network or existing world data.
      const probe=await run(gameImageProbe(pinned),{timeout:30000});
      assert(reportsGameVersion(probe,job.target),'The image binary does not report the reviewed Factorio version.');
      job.resolvedImage=pinned;await save();
      assert(await fs.readFile(path.join(root,'.env'),'utf8')===oldEnv,'Installation settings changed while downloading. No containers were replaced.');
      changed=true;
      await writeOwned('.env',setEnvironment(envPinned,'FACTORIO_IMAGE',pinned));
      const after=JSON.parse(await compose('config','--format','json'));validateDeployment(configBefore,after,job);
      await phase('Replacing Factorio. Players will reconnect after readiness checks…');applied=true;
      await compose('up','-d','--no-deps','--no-build','--pull','never','factorio');
      let ready=false;const deadline=now()+120000;
      while(now()<deadline){try{const value=await run(['exec',job.names.game,'rcon','/version'],{timeout:20000});if(reportsGameVersion(value,job.target)){ready=true;break;}}catch{}await wait(2000);}
      assert(ready,'The selected game version did not become ready.');
      await phase('Factorio image installed and its reported version verified. Clients must match '+job.target+'.','succeeded');
    }
  }catch(error){
    if(error.diagnostic){job.failure=error.diagnostic;console.error(JSON.stringify({update:job.id,...error.diagnostic}));}
    if(changed){
      try{
        if(job.kind==='panel'){
          await phase('Update failed. Recovering the previous panel release…','recovering');
          if(applied)await compose('stop','panel','panel-controller');
          if(sourcePromoted)await restoreSource();else await writeOwned('.env',oldEnv);
          if(applied){
            // These files belong to distinct service users; restore their owners.
            for(const [name,uid] of [['auth',1000],['controller',845],['secrets',845]]){
              const dest=path.join(root,'.panel-data',name);await fs.rm(dest,{recursive:true});await copyTree(path.join(recovery,name),dest);
              async function owner(file){const s=await fs.lstat(file);if(s.isDirectory())for(const n of await fs.readdir(file))await owner(path.join(file,n));if(process.getuid?.()===0)await fs.chown(file,uid,uid);}
              await owner(dest);
            }
            const tag='local/factory-control:recovery-'+id;await run(['tag',job.images.controller,tag]);
            await writeOwned('.env',setEnvironment(oldEnv,'PANEL_IMAGE',tag));
            await compose('up','-d','--no-deps','--no-build','--pull','never','--wait','--wait-timeout','120','panel-controller','panel');
            await writeOwned('.env',oldEnv);
          }
          job.message='Panel update failed; previous source/configuration recovered'+(applied?' and previous services restarted.':'. The running services were not replaced.');
        }else{
          if(applied){job.recovery={...job.recovery,requiresWorldRestore:true,action:'Game is stopped. The upgraded saves are preserved. Restore the pre-update backup explicitly from Backups before starting the old version.'};await save();await compose('stop','factorio');}
          await writeOwned('.env',oldEnv);
          if(applied){
            // Recreate with the old image, stopped, so explicit restore uses it.
            const tag='local/factory-control-game:recovery-'+id;await run(['tag',job.images.game,tag]);
            await writeOwned('.env',setEnvironment(oldEnv,'FACTORIO_IMAGE',tag));
            await compose('create','--no-build','--pull','never','factorio');
            await writeOwned('.env',oldEnv);
          }
          job.message=applied?'Factorio upgrade failed. Game stopped; restore the pre-update backup explicitly.':'Factorio download/preflight failed. The running game was not replaced.';
        }
      }catch{job.message='Update and automatic recovery did not complete. Keep the game stopped if upgrading Factorio and use the retained recovery copies. Host intervention is required.';}
    }else job.message=error.message;
    job.state='failed';
  }
  job.finished=new Date(now()).toISOString();await save();return job;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runUpdate({root:process.env.UPDATE_ROOT,state:process.env.UPDATE_STATE||'/updates',id:process.env.UPDATE_JOB}).catch(()=>{console.error('Update worker could not start. Check retained update state locally.');process.exitCode=1;});
}
