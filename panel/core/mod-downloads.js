import crypto from 'node:crypto';
import {assert} from '../common.js';

export const digest=(data,algorithm='sha256')=>crypto.createHash(algorithm).update(data).digest('hex');
export const compareVersions=(a,b)=>{
  const left=String(a).split('.').map(Number),right=String(b).split('.').map(Number);
  for(let i=0;i<Math.max(left.length,right.length);i++){const difference=(left[i]||0)-(right[i]||0);if(difference)return Math.sign(difference);}return 0;
};
export function versionMatches(version,operator,wanted){const n=compareVersions(version,wanted);return !wanted||({'=':n===0,'>':n>0,'>=':n>=0,'<':n<0,'<=':n<=0})[operator||'='];}
export function createModDownloads(fetcher=fetch,{now=Date.now}={}){
  const cache=new Map();
  async function bytes(input,{hosts,limit=8*1024**2,secret=false}={}){
    let url=new URL(input);
    for(let redirects=0;redirects<5;redirects++){
      assert(url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&hosts.includes(url.hostname),'Unexpected mod download location.',502);
      let response;try{response=await fetcher(url.href,{redirect:'manual',signal:AbortSignal.timeout(20000),headers:{'user-agent':'Lobby-Goblin mod library','accept':'application/json, application/octet-stream'}});}catch{throw Error('The mod source is unavailable. Try again later.');}
      if([301,302,303,307,308].includes(response.status)){url=new URL(response.headers.get('location'),url);await response.body?.cancel();continue;}
      assert(response.ok,secret?'Factorio download failed. Check the connected account and its mod access.':'The mod source is unavailable. Try again later.',502);
      assert(Number(response.headers.get('content-length')||0)<=limit,'Mod download exceeds its size limit.',502);
      const chunks=[];let length=0;const reader=response.body.getReader();
      try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;assert(length<=limit,'Mod download exceeds its size limit.',502);chunks.push(value);}}catch(error){if(secret)throw Error('Factorio download failed. Check the connected account and its mod access.');throw error;}finally{await reader.cancel().catch(()=>{});}
      return Buffer.concat(chunks);
    }throw Error('Too many mod download redirects.');
  }
  async function json(url,{refresh=false,ttl=300000,...options}={}){
    const previous=cache.get(url);
    if(!refresh&&previous&&now()-previous.at<ttl)return {...previous,stale:false};
    try{const data=JSON.parse((await bytes(url,options)).toString('utf8'));const value={data,at:now(),stale:false};if(cache.size>=150)cache.delete(cache.keys().next().value);cache.set(url,value);return value;}
    catch(error){if(!refresh&&previous&&now()-previous.at<86400000)return {...previous,stale:true};throw error;}
  }
  return {bytes,json};
}
