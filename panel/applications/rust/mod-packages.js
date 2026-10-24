import {gunzipSync} from 'node:zlib';
import crypto from 'node:crypto';
import {assert} from '../../common.js';
import {zipEntries} from '../../core/archive.js';

export const frameworks=Object.freeze({
 carbon:{name:'Carbon',repository:'CarbonCommunity/Carbon',asset:'Carbon.Linux.Release.tar.gz',release:'tags/production_build',plugins:'carbon/plugins',configs:'carbon/configs'},
 oxide:{name:'Oxide / uMod',repository:'OxideMod/Oxide.Rust',asset:'Oxide.Rust-linux.zip',release:'latest',plugins:'oxide/plugins',configs:'oxide/config'},
});
export const sha256=data=>crypto.createHash('sha256').update(data).digest('hex');
export function safePath(name){
 assert(typeof name==='string'&&name.length>0&&name.length<=240&&!name.includes('\\')&&!/[\x00-\x1f:]/.test(name)&&!name.startsWith('/')&&name.split('/').every(part=>part&&part!=='.'&&part!=='..'),'Unsafe framework archive path.');
 return name;
}
export async function boundedDownload(url,limit,fetcher=fetch,{api=false}={}){
 const parsed=new URL(url);
 assert(parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&(api?parsed.host==='api.github.com':parsed.host==='github.com'),'Only official GitHub framework releases are supported.');
 const response=await fetcher(url,{headers:{accept:api?'application/vnd.github+json':'application/octet-stream','user-agent':'Lobby-Goblin'},signal:AbortSignal.timeout(120000),redirect:'follow'});
 assert(response.ok,'The official framework download is unavailable.',502);
 let total=0;const chunks=[];
 for await(const part of response.body){total+=part.length;assert(total<=limit,'Framework download exceeds its limit.');chunks.push(part);}
 return Buffer.concat(chunks);
}
export async function frameworkRelease(framework,fetcher=fetch){
 const definition=frameworks[framework];assert(definition,'Choose Carbon or Oxide / uMod.');
 const release=JSON.parse((await boundedDownload('https://api.github.com/repos/'+definition.repository+'/releases/'+definition.release,1024*1024,fetcher,{api:true})).toString());
 const asset=release.assets?.find(asset=>asset.name===definition.asset&&asset.state==='uploaded');
 assert(asset&&/^sha256:[a-f0-9]{64}$/.test(asset.digest||'')&&Number.isSafeInteger(asset.size)&&asset.size>0&&asset.size<=64*1024**2,'The official release needs a published SHA-256 checksum and a supported Linux archive.',502);
 const url=new URL(asset.browser_download_url);
 assert(url.origin==='https://github.com'&&url.pathname.startsWith('/'+definition.repository+'/releases/download/')&&url.pathname.endsWith('/'+definition.asset)&&!url.search&&!url.hash,'Unexpected framework download location.');
 return {framework,version:String(release.tag_name).slice(0,100),asset:definition.asset,url:url.href,sha256:asset.digest.slice(7),size:asset.size};
}
function tarEntries(archive){
 const tar=gunzipSync(archive,{maxOutputLength:256*1024**2}),files=[];let offset=0,terminated=false,pax=null,headers=0;
 while(offset+512<=tar.length){
  const header=tar.subarray(offset,offset+512);offset+=512;
  if(header.every(byte=>byte===0)){assert(tar.subarray(offset).every(byte=>byte===0),'Unexpected framework TAR trailer.');terminated=true;break;}
  const text=(start,end)=>header.subarray(start,end).toString('utf8').replace(/\0.*$/s,'');
  const number=(start,end)=>{const raw=text(start,end).trim();assert(/^[0-7]+$/.test(raw),'Invalid framework TAR number.');return parseInt(raw,8);};
  const sum=number(148,156),check=Buffer.from(header);check.fill(32,148,156);assert(check.reduce((a,b)=>a+b,0)===sum,'Framework TAR checksum failed.');
  const prefix=text(345,500),raw=(prefix?prefix+'/':'')+text(0,100),type=header[156],size=number(124,136);
  assert(++headers<20000&&offset+size<=tar.length,'Framework TAR exceeds its limits.');
  if(type===120){
   assert(!pax&&size<=16384,'Unsupported framework PAX metadata.');pax={};let position=offset;
   while(position<offset+size){const space=tar.indexOf(32,position),length=Number(tar.subarray(position,space).toString());assert(space>position&&Number.isSafeInteger(length)&&length>space-position+2&&position+length<=offset+size,'Invalid framework PAX record.');const entry=tar.subarray(space+1,position+length-1).toString(),equal=entry.indexOf('='),key=entry.slice(0,equal);assert(equal>0&&['path','mtime','atime','ctime'].includes(key)&&!Object.hasOwn(pax,key)&&tar[position+length-1]===10,'Unsupported framework PAX record.');pax[key]=entry.slice(equal+1);position+=length;}
   offset+=Math.ceil(size/512)*512;continue;
  }
  const name=safePath((pax?.path||raw).replace(/\/$/,''));pax=null;
  assert([0,48,53].includes(type),'Links and special framework archive entries are not supported.');
  assert(size<=128*1024**2&&offset+size<=tar.length&&files.length<10000,'Framework TAR exceeds its limits.');
  if(type===53)assert(size===0,'Invalid framework directory.');else files.push({name,data:Buffer.from(tar.subarray(offset,offset+size)),mode:number(100,108)&0o111?0o755:0o644});
  offset+=Math.ceil(size/512)*512;
 }
 assert(terminated&&!pax&&files.length,'Incomplete framework TAR.');return files;
}
export function frameworkFiles(framework,archive){
 const files=framework==='carbon'?tarEntries(archive):zipEntries(archive).filter(entry=>!entry.name.endsWith('/')).map(entry=>({name:safePath(entry.name),data:entry.read(),mode:/\.so(?:\.\d+)*$/.test(entry.name)?0o755:0o644}));
 let total=0;const names=new Set();
 for(const file of files){
  safePath(file.name);assert(!names.has(file.name),'Duplicate framework path.');names.add(file.name);total+=file.data.length;assert(total<=256*1024**2,'Framework files exceed their limit.');
  assert(framework==='carbon'?/^(?:carbon\/(?:managed|native|tools)\/|libdoorstop\.so$|carbon\.sh$|Carbon\.targets$)/.test(file.name):/^RustDedicated_Data\/Managed\//.test(file.name),'Framework archive contains unexpected files.');
 }
 assert(framework==='carbon'?names.has('libdoorstop.so')&&names.has('carbon/managed/Carbon.Preloader.dll'):names.has('RustDedicated_Data/Managed/Oxide.Rust.dll')&&names.has('RustDedicated_Data/Managed/Assembly-CSharp.dll'),'The framework archive is incomplete.');
 return files;
}
