import http from 'node:http';
import {HttpError, redact} from './common.js';

export function docker(method, route, data, {raw=false,timeout=150000}={}) {
  return new Promise((resolve,reject)=>{
    const body=data===undefined ? undefined : Buffer.from(JSON.stringify(data));
    const req=http.request({socketPath:process.env.DOCKER_SOCKET||'/var/run/docker.sock', path:route, method,
      headers:body?{'content-type':'application/json','content-length':body.length}:{}},res=>{
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>32*1024*1024){req.destroy(new Error('Docker response is too large.'));return;}chunks.push(chunk);});
      res.on('end',()=>{
        const value=Buffer.concat(chunks);
        if(res.statusCode>=400){let message;try{message=JSON.parse(value).message;}catch{message='Docker operation failed.';}reject(new HttpError(res.statusCode===404?404:502,redact(message)));return;}
        if(raw){resolve(value);return;}
        try{resolve(value.length?JSON.parse(value):null);}catch{reject(new Error('Invalid Docker response.'));}
      });
      res.on('error',reject);
    });
    req.setTimeout(timeout,()=>req.destroy(new Error('Docker operation timed out.')));req.on('error',reject);req.end(body);
  });
}
export function demultiplex(buffer) {
  const chunks=[];let offset=0;
  while(offset+8<=buffer.length){const length=buffer.readUInt32BE(offset+4);if(buffer[offset]>2||offset+8+length>buffer.length)return buffer.toString('utf8');chunks.push(buffer.subarray(offset+8,offset+8+length));offset+=8+length;}
  return Buffer.concat(chunks).toString('utf8');
}
export async function rcon(command, container=process.env.FACTORIO_CONTAINER||'factorio-server') {
  const exec=await docker('POST',`/containers/${encodeURIComponent(container)}/exec`,{AttachStdout:true,AttachStderr:true,Cmd:['rcon',command]});
  const output=demultiplex(await docker('POST',`/exec/${exec.Id}/start`,{Detach:false,Tty:false},{raw:true,timeout:20000}));
  const state=await docker('GET',`/exec/${exec.Id}/json`);
  if(state.ExitCode!==0)throw new HttpError(409,'Factorio is not ready to receive commands.');
  return output.trim();
}
