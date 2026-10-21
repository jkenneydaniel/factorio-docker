import fs from 'node:fs/promises';
import path from 'node:path';
import {assert,json,sleep} from '../../common.js';
import {ownedImage} from '../../core/game-images.js';
import {demultiplex} from '../../core/docker.js';
import {createWebRcon,sanitizeLogs} from './transport.js';
import {fields,readSettings,saveSettings,validateSettings} from './settings.js';
import {inventory,writeArchive,verifyArchive} from './archive.js';

export async function createRust(ctx,{rcon=createWebRcon(),readyTimeout=600000,pollInterval=2000}={}){
  const {config,host,docker,env}=ctx,identityRoot=path.join(config.data,config.identity),settingsFile=path.join(identityRoot,'cfg/server.cfg');
  let recent=null,password;
  async function owned(){
    const info=await host.info(),labels=info.Config?.Labels||{};
    assert(labels['io.lobby-goblin.game']==='rust'&&labels['io.lobby-goblin.instance']===config.instance,'Container does not belong to this Rust installation. No changes were made.',409);
    assert(info.Mounts?.some(mount=>mount.Destination==='/steamcmd/rust'&&(config.managedVolume?mount.Type==='volume'&&mount.Name===config.managedVolume:mount.Type==='bind'&&path.resolve(mount.Source)===config.hostData)),'Rust container data mount does not match this installation.',409);
    assert(info.Config?.Image===config.image,'Rust container image does not match this installation.',409);
    assert(info.HostConfig?.RestartPolicy?.Name===(config.managedVolume?config.restartPolicy:'unless-stopped'),'Rust requires the unless-stopped restart policy.',409);
    const root=await fs.realpath(config.data);assert(root===path.resolve(config.data),'Rust data cannot be a symbolic link.');
    const marker=JSON.parse(await fs.readFile(path.join(config.data,'.lobby-goblin-rust.json'),'utf8'));
    assert(marker.game==='rust'&&marker.instance===config.instance,'Rust data does not belong to this installation.',409);
    const stat=await fs.lstat(identityRoot).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(stat)assert(stat.isDirectory()&&await fs.realpath(identityRoot)===identityRoot,'Rust identity cannot be a symbolic link.');
    const cfg=path.join(identityRoot,'cfg'),cfgStat=await fs.lstat(cfg).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(cfgStat)assert(cfgStat.isDirectory()&&await fs.realpath(cfg)===cfg,'Rust configuration cannot be a symbolic link.');
    return info;
  }
  async function command(value){
    const info=await owned();assert(info.State?.Running,'Rust is stopped.',409);
    const networks=Object.values(info.NetworkSettings?.Networks||{}).map(network=>network.IPAddress).filter(Boolean);
    assert(networks.length===1&&/^\d{1,3}(\.\d{1,3}){3}$/.test(networks[0]),'Rust must use its single isolated Docker network.',409);
    return rcon({host:networks[0],port:config.rconPort,password,command:value});
  }
  async function serverInfo(){const value=JSON.parse(await command('serverinfo'));assert(value&&typeof value==='object'&&!Array.isArray(value)&&Number.isFinite(value.Players),'Rust returned invalid server status.',502);return value;}
  function started(info,live){
    // WebRCON is available before SaveRestore and environment initialization.
    // Owned images publish a process-scoped health proof after startup completes.
    // Legacy bootstrap is migration-only; its runtime measurements stay zero
    // until the server has finished initializing.
    return ownedImage('rust',info.Config.Image)?info.State.Health?.Status==='healthy':live?.Framerate>0&&live?.Memory>0;
  }
  async function ready(){
    const initial=await owned(),restarts=initial.RestartCount||0,deadline=Date.now()+readyTimeout;
    do{
      try{const live=await serverInfo();if(started(await owned(),live))return;}catch{}
      const current=await owned();
      assert(current.State?.Running&&!current.State?.Restarting&&!current.State?.OOMKilled&&(current.RestartCount||0)===restarts,'Rust exited or restarted before becoming ready. Check its logs and host resources before retrying.');
      await sleep(pollInterval);
    }while(Date.now()<deadline);
    throw Error('Rust did not become ready in time. It may still be loading; check status and logs before retrying.');
  }
  async function start(){const info=await owned();if(!info.State?.Running)await host.control('start');await ready();return 'Rust is ready.';}
  async function stop(){
    const info=await owned();if(!info.State?.Running)return 'Rust is already stopped.';
    // Fail closed if a running server cannot save. Docker's unlimited graceful
    // stop signals the image shutdown handler; never escalate to SIGKILL.
    assert(started(info,await serverInfo()),'Wait for Rust to finish startup before saving or stopping.',409);
    await command('server.save');await owned();await host.control('stop');
    const stopped=await owned();assert(!stopped.State?.Running&&!stopped.State?.Restarting&&stopped.State?.ExitCode===0&&!stopped.State?.OOMKilled,'Rust did not stop cleanly. Check status and logs before retrying.');
    return 'Rust saved and stopped.';
  }
  async function backup(target,label){
    const info=await owned(),resume=!!info.State?.Running;
    // Preflight before interrupting players; inventory again after shutdown.
    await inventory(identityRoot,{requireSave:!resume});
    let stopped=false,originalError;
    try{
      if(resume){await stop();stopped=true;}else assert(info.State?.ExitCode===0&&!info.State?.Restarting&&!info.State?.OOMKilled,'Rust last stopped uncleanly. Start and cleanly stop it before backing up.');
      assert(!(await owned()).State?.Running,'Rust restarted during backup.');
      await writeArchive(target,identityRoot,{identity:config.identity,instance:config.instance,label});
      assert(!(await owned()).State?.Running,'Rust restarted during backup; snapshot discarded.');
      await verifyArchive(target);
    }catch(error){originalError=error;throw error;}
    finally{if(stopped){try{await start();}catch{throw Error((originalError?'Backup failed. ':'Snapshot copying finished, but the backup was not published. ')+'Rust could not be resumed; check status and start it manually.');}}}
  }
  async function status(){
    const info=await owned();let live=null,error=null;
    if(info.State?.Running)try{live=await serverInfo();}catch{error='Rust is starting or WebRCON is unavailable.';}
    const initialized=!!live&&started(info,live);if(live&&!initialized)error='Rust is still initializing its world.';
    const metrics=await host.metrics(!!info.State?.Running);
    recent={game:'rust',name:live?.Hostname||'Rust server',running:!!info.State?.Running,ready:initialized,state:info.State?.Status||'unknown',
      players:live?.Players??null,maxPlayers:live?.MaxPlayers??null,fps:live?.Framerate??null,uptime:live?.Uptime??null,
      connection:env.RUST_GAME_ADDRESS||'localhost:28015',identity:config.identity,...metrics,error,activeJob:ctx.active};return recent;
  }
  return {
    actions:{start,stop,restart:async()=>{await stop();await start();return 'Rust restarted and is ready.';},
      'save-settings':async params=>{await owned();assert(!(await owned()).State?.Running,'Stop Rust before saving settings.',409);await saveSettings(settingsFile,params.values,params.revision);return 'Settings saved. They take effect when Rust starts.';}},
    status,recentStatus:()=>recent,locations:[{id:'rust-identity',title:'Rust identity',path:identityRoot}],
    backupExtension:'.tar.gz',writeBackup:backup,verifyBackupFile:verifyArchive,
    backupVerified:result=>`Rust archive verified: ${result.files} files, including a world save. Archive integrity checked; game-load recovery is a separate test.`,
    validateAction(body){
      if(['stop','restart','backup'].includes(body.action))assert(body.params?.confirm===true,'Confirm the Rust server interruption first.');
      if(body.action==='save-settings'){validateSettings(body.params?.values);assert(typeof body.params?.revision==='string','Reload settings first.');}
    },
    validateSchedule(value){if(value.enabled)assert(value.confirmDowntime===true,'Confirm that scheduled backups briefly stop Rust.');},
    async handle(req,res,url){
      assert(req.method==='GET','Not found.',404);
      if(url.pathname==='/players'){
        const info=await owned();if(!info.State?.Running)return json(res,200,{players:[],available:false,message:'Rust is stopped.'});
        const values=JSON.parse(await command('playerlist'));assert(Array.isArray(values)&&values.length<=1000,'Invalid Rust player list.',502);
        return json(res,200,{available:true,players:values.map(value=>({id:String(value.SteamID||''),name:String(value.DisplayName||''),ping:Number.isFinite(Number(value.Ping))?Number(value.Ping):null,connectedSeconds:Number(value.ConnectedSeconds)||0}))});
      }
      if(url.pathname==='/logs'){
        await owned();const logs=await docker('GET',`/containers/${encodeURIComponent(config.container)}/logs?stdout=true&stderr=true&tail=300`,undefined,{raw:true});
        return json(res,200,{logs:sanitizeLogs(demultiplex(logs),password)});
      }
      if(url.pathname==='/settings'){
        const info=await owned(),value=await readSettings(settingsFile);
        return json(res,200,{fields,values:value.values,configured:value.configured,revision:value.revision,editable:!info.State?.Running&&!ctx.active,message:'Stop Rust before saving. Changes apply at the next start. Unlisted settings are preserved.'});
      }
      assert(false,'Not found.',404);
    },
    async init(){password=(await fs.readFile(config.passwordFile,'utf8')).trim();assert(/^[A-Za-z0-9_-]{32,128}$/.test(password),'Rust requires a 32–128 character generated WebRCON secret.');},
    async start(){},async beforeJob(){await owned();},async afterJob(){},async waitIdle(){},invalidate(){recent=null;},
  };
}
