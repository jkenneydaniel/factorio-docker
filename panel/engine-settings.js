import {docker} from './docker.js';
import {assert} from './common.js';

// Read the installed game's configuration via Docker's read-only archive API.
// This also works while the game is stopped. No game example files are vendored.
export function jsonWithComments(text){
  let out='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i],next=text[i+1];
    if(quoted){out+=c;if(c==='\\')out+=text[++i]||'';else if(c==='"')quoted=false;continue;}
    if(c==='"'){quoted=true;out+=c;continue;}
    if(c==='/'&&next==='/'){while(i<text.length&&text[i]!=='\n')i++;out+='\n';continue;}
    if(c==='/'&&next==='*'){i+=2;while(i<text.length&&!(text[i]==='*'&&text[i+1]==='/'))i++;i++;out+=' ';continue;}
    out+=c;
  }
  let clean='';quoted=false;
  for(let i=0;i<out.length;i++){
    const c=out[i];
    if(quoted){clean+=c;if(c==='\\')clean+=out[++i]||'';else if(c==='"')quoted=false;continue;}
    if(c==='"')quoted=true;
    if(c===','){let j=i+1;while(j<out.length&&/\s/.test(out[j]))j++;if(out[j]==='}'||out[j]===']')continue;}
    clean+=c;
  }
  return JSON.parse(clean);
}
export function archiveText(buffer,basename){
  for(let offset=0;offset+512<=buffer.length;){
    const header=buffer.subarray(offset,offset+512);if(header.every(n=>n===0))break;
    const name=header.subarray(0,100).toString().split('\0')[0];
    const size=parseInt(header.subarray(124,136).toString().replace(/\0/g,'').trim(),8);
    assert(Number.isSafeInteger(size)&&size>=0&&offset+512+size<=buffer.length,'Invalid game settings archive.');
    if(name.split('/').at(-1)===basename){assert(size<512*1024,'Game settings file is too large.');return buffer.subarray(offset+512,offset+512+size).toString('utf8');}
    offset+=512+Math.ceil(size/512)*512;
  }
  throw new Error('Game settings were not found in the installed image.');
}
export function mergeSettings(base,chosen){
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
  if(!object(base)||!object(chosen))return structuredClone(chosen);
  const result=structuredClone(base);
  for(const [key,value] of Object.entries(chosen))result[key]=object(value)&&object(base[key])?mergeSettings(base[key],value):structuredClone(value);
  return result;
}
let cached=null;
export async function engineMapSettings(container,image){
  if(cached?.image===image)return structuredClone(cached.settings);
  const basename='map-settings.example.json';
  const raw=await docker('GET',`/containers/${encodeURIComponent(container)}/archive?path=${encodeURIComponent('/opt/factorio/data/'+basename)}`,undefined,{raw:true});
  const settings=jsonWithComments(archiveText(raw,basename));
  assert(settings&&typeof settings==='object'&&!Array.isArray(settings),'Invalid installed game settings.');
  cached={image,settings};return structuredClone(settings);
}
