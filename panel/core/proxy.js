import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

// Downloads have a header/read idle deadline, not a total transfer deadline.
// Backpressure pauses reads (and their deadline) while the client catches up.
export async function proxyResponse(req,res,url,{headers,body,download=false,timeout=30000,fetcher=fetch}={}){
  const controller=new AbortController();let timer;
  const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(),timeout).unref();};
  const disconnect=()=>controller.abort();res.once('close',disconnect);
  try{
    arm();
    const response=await fetcher(url,{method:req.method,headers,body,redirect:'error',signal:controller.signal});
    if(download)clearTimeout(timer);
    for(const key of ['content-type','content-disposition'])if(response.headers.has(key))res.setHeader(key,response.headers.get(key));
    res.setHeader('cache-control','no-store');res.writeHead(response.status);
    if(!response.body)return res.end();
    const reader=response.body.getReader();
    async function* chunks(){
      try{
        for(;;){
          if(download)arm();
          let result;try{result=await reader.read();}finally{if(download)clearTimeout(timer);}
          if(result.done)return;yield result.value;
        }
      }finally{reader.releaseLock();}
    }
    // pipeline bounds buffering and destroys an incomplete downstream response
    // on upstream failure, so a truncated archive cannot look like a clean EOF.
    await pipeline(Readable.from(chunks(),{objectMode:false}),res);
  }finally{
    clearTimeout(timer);res.off('close',disconnect);controller.abort();
  }
}
