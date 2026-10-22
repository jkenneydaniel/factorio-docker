import {assert} from '../../common.js';
import {digest,compareVersions} from '../../core/mod-downloads.js';

const hosts=['umod.org','assets.umod.org'];
const slug=value=>{assert(typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,99}$/.test(value),'Choose a uMod plugin.');return value;};
const filename=value=>{assert(/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(value||''),'Unsupported uMod plugin filename.',502);return value+'.cs';};
function entry(value){
  const id=slug(value.slug),name=filename(value.name);
  assert(/^\d+(\.\d+){1,3}$/.test(value.latest_release_version||''),'Plugin version is unavailable.',502);
  return {id,name,title:String(value.title||value.name).slice(0,150),summary:String(value.description||'').slice(0,700),author:String(value.author||'').slice(0,100),version:value.latest_release_version,downloads:Number(value.downloads)||0,url:'https://umod.org/plugins/'+id,checksum:value.latest_release_version_checksum,available:value.distribution==='download'&&value.status_detail?.value===1&&value.games_detail?.some(game=>['rust','universal'].includes(game.slug))};
}
export function createRustCatalog(downloads){
  async function detail(id,refresh=false){const result=await downloads.json('https://umod.org/plugins/'+slug(id)+'.json',{hosts,refresh});return {...entry(result.data),stale:result.stale};}
  return {
    source:'uMod',
    async browse({query='',page=1,refresh=false}={}){
      const url=new URL('https://umod.org/plugins/search.json');url.search=new URLSearchParams({query,page:String(page),sort:'latest_release_at',sortdir:'desc','categories[]':'rust'});
      const result=await downloads.json(url.href,{hosts,refresh});assert(Array.isArray(result.data.data),'Invalid uMod catalogue response.',502);
      const items=result.data.data.flatMap(value=>{try{return [entry(value)];}catch{return [];}});
      return {items,page:Number(result.data.current_page)||page,pages:Number(result.data.last_page)||1,stale:result.stale,checkedAt:new Date(result.at).toISOString()};
    },detail,
    async resolve(id,context){
      assert(['oxide','carbon'].includes(context.scope),'Install Oxide or Carbon before installing plugins.',409);
      const item=await detail(id,true);assert(item.available,'This plugin is not available as a public Rust download.',409);
      assert(/^[a-f0-9]{40}$/.test(item.checksum||''),'uMod did not provide a plugin checksum.',502);
      const data=await downloads.bytes('https://umod.org/plugins/'+item.name,{hosts,limit:512*1024});
      assert(data.length>0&&digest(data,'sha1')===item.checksum,'Plugin changed while being reviewed. Review it again.',409);
      const source=data.toString('utf8');assert(!source.includes('\0')&&!/^\s*<(?:!doctype|html)/i.test(source),'Invalid C# plugin download.',502);
      const manifest=(await downloads.json('https://assets.umod.org/plugins/'+item.name.slice(0,-3)+'.json',{hosts,refresh:true})).data;
      const release=manifest.branches?.master?.[item.version];
      assert(release&&release.checksum===item.checksum,'Plugin dependency metadata is out of date. Try again later.',409);
      // uMod dependency constraints are package-manager expressions. Refuse
      // unfulfilled dependencies rather than guessing an install order/version.
      for(const [name,constraint] of Object.entries(release.requires||{})){
        const installed=context.items.find(value=>value.name===name+'.cs'&&value.enabled);
        assert(installed&&(!constraint||constraint==='*'||constraint===installed.version),'Install the required plugin '+name+' ('+constraint+') first.',409);
      }
      const previous=context.items.find(value=>value.name===item.name);
      assert(!previous?.version||compareVersions(item.version,previous.version)>=0,'A newer plugin is already installed.',409);
      return [{...item,data,dependencies:Object.keys(release.requires||{}),note:context.scope==='carbon'?'Oxide plugin on Carbon: check its compatibility and compilation after starting.':'Check plugin compilation after starting.'}];
    }
  };
}
