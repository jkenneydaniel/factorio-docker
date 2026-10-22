import {assert} from '../../common.js';
import {zipEntries} from '../../core/archive.js';
import {digest,compareVersions,versionMatches} from '../../core/mod-downloads.js';

const hosts=['mods.factorio.com','dl-mod.factorio.com','mods-data.factorio.com'];
export const modName=value=>{assert(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_ -]{0,99}$/.test(value),'Invalid Factorio mod name.');return value;};
export function dependency(value){
  const match=String(value).match(/^\s*(\(\?\)|[?!~])?\s*([A-Za-z0-9][A-Za-z0-9_ -]*?)(?:\s*(>=|<=|=|>|<)\s*(\d+(?:\.\d+){1,2}))?\s*$/);
  assert(match,'Unsupported Factorio dependency: '+String(value).slice(0,120),409);
  return {kind:match[1]||'',name:modName(match[2].trim()),operator:match[3],version:match[4]};
}
export function factorioPackage(data,name,version){
  const entries=zipEntries(data),top=name+'_'+version+'/';
  assert(entries.every(entry=>entry.name.startsWith(top)),'Mod ZIP has an unexpected root directory.',502);
  const info=entries.find(entry=>entry.name===top+'info.json');assert(info&&info.size<128*1024,'Mod ZIP is missing its metadata.',502);
  const value=JSON.parse(info.read().toString('utf8'));assert(value.name===name&&value.version===version,'Mod ZIP does not match the selected release.',502);
  return value;
}
const series=version=>String(version).split('.').slice(0,2).join('.');
export function createFactorioCatalog(downloads,{credentials}={}){
  async function detail(id,refresh=false){const result=await downloads.json('https://mods.factorio.com/api/mods/'+encodeURIComponent(modName(id))+'/full',{hosts,refresh});return {...result.data,catalogueStale:result.stale};}
  const summarize=(value,release)=>({id:value.name,name:value.name,title:String(value.title||value.name).slice(0,150),summary:String(value.summary||'').slice(0,700),author:String(value.owner||'').slice(0,100),version:release?.version||null,downloads:Number(value.downloads_count)||0,url:'https://mods.factorio.com/mod/'+encodeURIComponent(value.name),available:!!release&&!value.deprecated});
  return {
    source:'Factorio Mod Portal',detail:async(id)=>{const value=await detail(id);return summarize(value,value.releases?.at(-1));},
    async browse({query='',page=1,refresh=false,version}={}){
      const result=await downloads.json('https://mods.factorio.com/api/mods?page_size=max&version='+encodeURIComponent(version),{hosts,limit:32*1024**2,ttl:600000,refresh});
      assert(Array.isArray(result.data.results),'Invalid Factorio catalogue response.',502);
      const needle=query.toLowerCase(),all=result.data.results.filter(value=>!value.deprecated&&series(value.latest_release?.info_json?.factorio_version)===series(version)&&(!needle||[value.name,value.title,value.summary].join(' ').toLowerCase().includes(needle))).sort((a,b)=>(b.downloads_count||0)-(a.downloads_count||0));
      return {items:all.slice((page-1)*20,page*20).map(value=>summarize(value,value.latest_release)),page,pages:Math.max(1,Math.ceil(all.length/20)),stale:result.stale,checkedAt:new Date(result.at).toISOString()};
    },
    async latest(id,context,refresh=false){const value=await detail(id,refresh);return {...summarize(value,value.releases?.filter(release=>/^\d+(\.\d+){1,2}$/.test(release.version)&&series(release.info_json?.factorio_version)===series(context.version)).sort((a,b)=>compareVersions(b.version,a.version))[0]),stale:value.catalogueStale};},
    async resolve(id,context){
      const details=new Map(),builtins=context.builtins;
      async function releases(name){
        if(!details.has(name)){assert(details.size<50,'This mod set exceeds the 50 dependency review limit.',409);details.set(name,await detail(name,true));}
        const value=details.get(name);assert(!value.deprecated,'The mod '+name+' is deprecated.',409);
        const installed=context.items.find(item=>item.id===name);
        return (value.releases||[]).filter(release=>/^\d+(\.\d+){1,2}$/.test(release.version)&&series(release.info_json?.factorio_version)===series(context.version)).sort((a,b)=>a.version===installed?.version?-1:b.version===installed?.version?1:compareVersions(b.version,a.version));
      }
      const root=(await releases(modName(id))).sort((a,b)=>compareVersions(b.version,a.version))[0];assert(root,'No release supports this Factorio version.',409);
      const initial=new Map(context.items.filter(item=>item.enabled).map(item=>[item.id,null]));initial.set(id,root);
      let attempts=0;
      async function solve(selection){
        assert(++attempts<=1000,'Dependency resolution is too complex. Choose a smaller mod set.',409);
        const required=new Set(selection.keys()),constraints=[];
        for(const release of selection.values())if(release)for(const text of release.info_json?.dependencies||['base']){
          const item=dependency(text);constraints.push(item);if(!['!','?','(?)'].includes(item.kind))required.add(item.name);
        }
        for(const item of constraints){
          const builtin=Object.hasOwn(builtins,item.name),selected=builtin?(builtins[item.name]?{version:builtins[item.name]}:null):selection.get(item.name);
          if(item.kind==='!'&&selected&&(!item.version||versionMatches(selected.version,item.operator,item.version)))return null;
          if(item.kind!=='!'&&selected&&!versionMatches(selected.version,item.operator,item.version))return null;
          if(builtin&&!selected?.version&&required.has(item.name))return null;
        }
        for(const name of required){
          if(Object.hasOwn(builtins,name)){if(!builtins[name])return null;continue;}
          if(selection.get(name))continue;
          for(const release of await releases(name)){
            const next=new Map(selection);next.set(name,release);const answer=await solve(next);if(answer)return answer;
          }return null;
        }
        return selection;
      }
      const selected=await solve(initial);assert(selected,'No compatible mod set was found. Check dependencies, conflicts and enabled expansion features.',409);
      const account=await credentials();assert(account?.username&&account?.token,'Connect a Factorio account before downloading mods.',409);
      const changes=[];let downloaded=0;
      for(const [name,release] of selected){
        const installed=context.items.find(item=>item.id===name);
        if(installed?.version===release.version&&installed.enabled)continue;
        assert(/^\/download\/[A-Za-z0-9_%./ -]+$/.test(release.download_url||'')&&!release.download_url.includes('..')&&/^[a-f0-9]{40}$/.test(release.sha1||''),'Invalid mod release download.',502);
        const url=new URL(release.download_url,'https://mods.factorio.com');url.search=new URLSearchParams({username:account.username,token:account.token});
        const data=await downloads.bytes(url.href,{hosts,limit:64*1024**2,secret:true});assert(digest(data,'sha1')===release.sha1,'Mod changed while being reviewed. Review it again.',409);
        downloaded+=data.length;assert(downloaded<=256*1024**2,'Mod downloads exceed the 256 MiB review limit.',409);
        const info=factorioPackage(data,name,release.version);assert(series(info.factorio_version)===series(context.version),'Downloaded mod targets another Factorio version.',409);
        assert(JSON.stringify(info.dependencies||['base'])===JSON.stringify(release.info_json?.dependencies||['base']),'Mod dependency metadata changed. Review it again.',409);
        changes.push({...summarize(details.get(name),release),name:name+'_'+release.version+'.zip',data,dependencies:info.dependencies||['base']});
      }
      assert(changes.length,'This mod and its dependencies are already installed.',409);return changes;
    }
  };
}
