import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {initializePanel} from './init.js';
import {validateWorld} from './zip.js';

export async function setup(root,args=[],{url='http://localhost:8080',ownership=false,log=console.log}={}){
  root=path.resolve(root);
  const exists=async file=>!!await fs.lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  const saveIndex=args.indexOf('--save'),save=saveIndex>=0?args[saveIndex+1]:null;
  const recover=args.includes('--registration-link'),fresh=args.includes('--new-world');
  const allowed=new Set(['--save','--new-world','--registration-link',...(save?[save]:[])]);
  if(args.some(arg=>!allowed.has(arg))||saveIndex>=0&&(!save||save.startsWith('--'))||save&&fresh||args.filter(x=>x==='--save').length>1)throw new Error('Use --new-world OR --save /workspace/import/world.zip. Recovery: --registration-link.');
  const origin=new URL(url);
  if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('Panel URL must be an HTTP(S) origin.');
  // Only ordinary directories are allowed for managed state, even on reruns.
  for(const relative of ['data','data/config','data/saves','data/mods','backups','.panel-data','.panel-data/auth','.panel-data/controller','.panel-data/secrets']){
    const stat=await fs.lstat(path.join(root,relative)).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(stat&&!stat.isDirectory())throw new Error(`Setup refuses a symlink or non-directory at ${relative}.`);
  }
  const savesDir=path.join(root,'data/saves');
  const saves=(await fs.readdir(savesDir).catch(error=>{if(error.code==='ENOENT')return [];throw error;})).filter(name=>name.endsWith('.zip'));
  if(save&&saves.length)throw new Error('Existing saves found. Import through Worlds in the panel; setup will not replace a running world.');
  if(!saves.length&&!save&&!fresh&&!recover)throw new Error('Choose --new-world or --save /workspace/import/world.zip for first-time setup.');
  let imported;
  if(save){
    const source=path.resolve(root,save),stat=await fs.stat(source);
    if(!stat.isFile()||stat.size>128*1024*1024)throw new Error('Choose a Factorio ZIP save no larger than 128 MB.');
    imported=await fs.readFile(source);
    for(const entry of validateWorld(imported))entry.read();
  }
  const state=path.join(root,'.panel-data');
  const hasToken=await exists(path.join(state,'secrets/controller-token'));
  const hasAuth=await exists(path.join(state,'auth/users.json'));
  if(hasToken!==hasAuth)throw new Error('Incomplete panel state detected. Preserve it and consult the recovery instructions before continuing.');
  const created=[];
  async function directory(relative,uid,mode=0o755){
    const target=path.join(root,relative);
    if(!await exists(target)){await fs.mkdir(target,{mode});created.push({target,uid,directory:true});}
  }
  for(const [relative,uid,mode] of [['data',845],['data/config',845],['data/saves',845],['data/mods',845],['backups',845],['.panel-data',845],['.panel-data/auth',1000,0o700],['.panel-data/controller',845,0o750],['.panel-data/secrets',845,0o700]])await directory(relative,uid,mode);
  async function createFile(relative,value,uid){
    const target=path.join(root,relative);
    try{await fs.writeFile(target,value,{flag:'wx',mode:0o600});created.push({target,uid});}
    catch(error){if(error.code!=='EEXIST')throw error;}
  }
  await createFile('data/config/server-settings.json',JSON.stringify({name:'Factory Control',description:'A private LAN factory',max_players:0,visibility:{public:false,lan:true},require_user_verification:false,auto_pause:true,autosave_interval:5,autosave_slots:10,auto_save_on_last_player_leaving:true,game_password:''},null,2),845);
  for(const name of ['server-adminlist.json','server-banlist.json','server-whitelist.json'])await createFile('data/config/'+name,'[]\n',845);
  if(imported)await createFile('data/saves/Imported-world.zip',imported,845);
  const result=await initializePanel(state,url,{recovery:recover});
  if(ownership){
    // Never recursively chown existing worlds, accounts, or backups.
    async function own(target,uid){
      const stat=await fs.lstat(target);
      if(stat.isSymbolicLink())throw new Error('Refusing ownership change on a symlink.');
      if(stat.isDirectory())for(const name of await fs.readdir(target))await own(path.join(target,name),uid);
      await fs.chown(target,uid,uid);
    }
    for(const item of created){
      if(item.directory&&['auth','secrets','controller'].includes(path.basename(item.target)))await own(item.target,item.uid);
      else await fs.chown(item.target,item.uid,item.uid);
    }
    if(result.link)await fs.chown(path.join(state,'registration-link.txt'),845,845);
    // Both service UIDs read the same file via a read-only file bind mount.
    // The enclosing host secrets directory stays 0700, owned by the controller.
    if(!hasToken)await fs.chmod(path.join(state,'secrets/controller-token'),0o444);
    // Recovery changes only accounts created by this operation, preserving UID.
    if(recover){await fs.chown(path.join(state,'auth/users.json'),1000,1000);}
  }
  log(saves.length?'Existing world and configuration preserved.':imported?'Imported world copied; original left untouched.':'A new world will be generated on the first game start.');
  log(result.link||'Panel registration already initialized. Recovery: run setup --registration-link.');
  return result;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await setup(process.env.SETUP_ROOT||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),process.argv.slice(2),{url:process.env.PANEL_URL||'http://localhost:8080',ownership:process.getuid?.()===0});}
  catch(error){console.error('Setup: '+error.message);process.exitCode=1;}
}
