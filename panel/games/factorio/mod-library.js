import fs from 'node:fs/promises';
import path from 'node:path';
import {assert,readJSON,writeJSON} from '../../common.js';
import {zipEntries} from '../../core/archive.js';
import {createModStore,realDirectory} from '../../core/mod-store.js';
import {createModDownloads,digest,versionMatches} from '../../core/mod-downloads.js';
import {createModLibrary} from '../../core/mod-library.js';
import {createFactorioCatalog,dependency} from './mod-catalog.js';

const builtinNames=['base','space-age','quality','elevated-rails'];
export function createFactorioModLibrary(ctx,{fetcher=fetch,start,stop}={}){
  const {data,state}=ctx.config,store=createModStore(path.join(data,'mods')),accountFile=path.join(state,'factorio-mod-account.json');
  async function credentials(){await realDirectory(state);const stat=await fs.lstat(accountFile).catch(error=>{if(error.code==='ENOENT')return null;throw error;});assert(!stat||stat.isFile()&&!stat.isSymbolicLink(),'Invalid Factorio account storage.',409);return readJSON(accountFile,null);}
  const assertStopped=async()=>assert(!(await ctx.host.info()).State?.Running,'Stop Factorio before changing mods.',409);
  const adapter={
    game:'factorio',note:'Uses the official Factorio Mod Portal. Changes apply when you start Factorio. Players can synchronize mods when joining.',
    editable:async()=>!(await ctx.host.info()).State?.Running&&!ctx.active&&!ctx.imageMigrationPending&&!ctx.updater.busy,
    store:async()=>store,
    policy:async()=>({running:!!(await ctx.host.info()).State?.Running,hotAvailable:false}),
    reviewMode:async mode=>{assert(mode!=='hot','Factorio requires a restart for mod changes.',409);if(mode==='stopped')await assertStopped();},
    prepare:async mode=>{if(mode==='restart'&&(await ctx.host.info()).State?.Running)await stop();},
    assertApplying:assertStopped,finish:async mode=>{if(mode==='restart')await start();},
    async accountStatus(){return {connected:!!(await credentials())?.token};},
    async account(body){
      await realDirectory(state);await credentials();
      if(body.disconnect===true){await fs.rm(accountFile,{force:true});return {connected:false};}
      assert(typeof body.username==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(body.username)&&typeof body.token==='string'&&/^[A-Za-z0-9_-]{20,256}$/.test(body.token),'Enter your Factorio username and service token.');
      await writeJSON(accountFile,{username:body.username,token:body.token});return {connected:true};
    },
    async inventory(){
      const server=await ctx.host.info(),image=await ctx.docker('GET','/images/'+encodeURIComponent(server.Image||server.Config.Image)+'/json');
      const version=image.Config?.Labels?.['factorio.version']||server.Config.Image.match(/(?:^|:)(\d+\.\d+\.\d+)/)?.[1];assert(/^\d+\.\d+\.\d+$/.test(version||''),'Cannot determine the installed Factorio version.',409);
      const files=await store.list(),list=files.get('mod-list.json'),configuration=list?JSON.parse(list.data):{mods:[]};assert(Array.isArray(configuration.mods),'Invalid Factorio mod-list.json.',409);
      const builtins=Object.fromEntries(builtinNames.map(name=>[name,name==='base'||configuration.mods.find(mod=>mod.name===name)?.enabled===true?version:null]));
      const items=[];
      for(const [name,file] of files){if(!name.endsWith('.zip'))continue;
        const entries=zipEntries(file.data),info=entries.find(entry=>/^[^/]+\/info\.json$/.test(entry.name));assert(info&&info.size<128*1024,'Installed mod ZIP is missing info.json: '+name,409);
        const value=JSON.parse(info.read().toString());assert(typeof value.name==='string'&&/^\d+(\.\d+){1,2}$/.test(value.version||''),'Installed mod has invalid metadata.',409);
        assert(!items.some(item=>item.id===value.name),'Multiple versions of '+value.name+' are present. Remove duplicates before using the library.',409);
        items.push({id:value.name,name,title:value.title||value.name,version:value.version,dependencies:value.dependencies||['base'],enabled:configuration.mods.find(mod=>mod.name===value.name)?.enabled!==false,sha256:digest(file.data)});
      }
      return {scope:'factorio',version,items,files,builtins,configuration};
    },
    async changes({context,releases,operation,id}){
      const configuration=structuredClone(context.configuration),changes=[];
      const setEnabled=(name,enabled)=>{const found=configuration.mods.find(mod=>mod.name===name);if(found)found.enabled=enabled;else configuration.mods.push({name,enabled});};
      if(operation==='install')for(const release of releases){const previous=context.items.find(item=>item.id===release.id);if(previous&&previous.name!==release.name)changes.push({name:previous.name,data:null});changes.push({name:release.name,data:release.data});setEnabled(release.id,true);}
      else{
        const item=context.items.find(item=>item.id===id);assert(item,'Choose an installed mod.',404);
        setEnabled(id,operation==='enable');if(operation==='remove'){changes.push({name:item.name,data:null});configuration.mods=configuration.mods.filter(mod=>mod.name!==id);}
        const enabled=context.items.filter(item=>item.id!==id?item.enabled:operation==='enable');
        for(const item of enabled)for(const text of item.dependencies){const dep=dependency(text),target=Object.hasOwn(context.builtins,dep.name)?context.builtins[dep.name]:enabled.find(item=>item.id===dep.name)?.version;
          if(dep.kind==='!')assert(!target||dep.version&&!versionMatches(target,dep.operator,dep.version),item.title+' conflicts with '+dep.name+'.',409);
          else if(!['?','(?)'].includes(dep.kind)||target)assert(target&&versionMatches(target,dep.operator,dep.version),item.title+' requires '+dep.name+'.',409);
        }
      }
      changes.push({name:'mod-list.json',data:Buffer.from(JSON.stringify(configuration,null,2))});return changes;
    }
  };
  return createModLibrary({state,provider:createFactorioCatalog(createModDownloads(fetcher),{credentials}),adapter,assertStopped,canPlan:()=>!ctx.active&&!ctx.updater.busy&&!ctx.imageMigrationPending});
}
