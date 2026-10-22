import tls from 'node:tls';
import net from 'node:net';
import http2 from 'node:http2';
import {Readable} from 'node:stream';
import {assert,equalSecret} from '../common.js';
import {certificatePin} from './agent-identity.js';

// A single multiplexed connection per paired host. Only the TCP/TLS connection
// is retried: an interrupted command is never replayed automatically.
export class AgentConnection{
 constructor(origin,fingerprint,{retry=1000,pingInterval=20000,connectTimeout=5000}={}){
  assert(/^[a-f0-9]{64}$/.test(fingerprint),'Invalid paired agent identity.');
  this.origin=new URL(origin);assert(this.origin.protocol==='https:','An encrypted agent address is required.');
  this.fingerprint=fingerprint;this.retry=retry;this.pingInterval=pingInterval;this.connectTimeout=connectTimeout;this.failures=0;this.sessions=new Set();
 }
 start(){if(!this.closed)void this.session().catch(()=>{});return this;}
 reconnect(){
  if(this.closed||this.retryTimer)return;
  this.retryTimer=setTimeout(()=>{this.retryTimer=null;this.start();},Math.min(this.retry*2**Math.min(this.failures++,5),30000)).unref();
 }
 async session(){
  assert(!this.closed,'This host connection is closed.',502);
  if(this.current&&!this.current.closed&&!this.current.destroyed)return this.current;
  if(this.dialing)return this.dialing;
  this.dialing=this.connect().catch(error=>{this.reconnect();throw error;}).finally(()=>{this.dialing=null;});return this.dialing;
 }
 async connect(){
  const hostname=this.origin.hostname.replace(/^\[|\]$/g,'');
  // No application bytes or credentials are sent until the exact certificate
  // from the pairing code has been checked. Public CAs and DNS are not trusted
  // to replace this identity, including on subsequent reconnects.
  const socket=tls.connect({host:hostname,port:Number(this.origin.port||443),servername:net.isIP(hostname)?undefined:hostname,rejectUnauthorized:false,minVersion:'TLSv1.3',ALPNProtocols:['h2']});this.socket=socket;
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>socket.destroy(Error('Agent connection timed out.')),this.connectTimeout).unref();
   const failed=error=>{clearTimeout(timer);reject(error);};const closed=()=>failed(Error('Agent connection closed.'));socket.once('error',failed);socket.once('close',closed);
   socket.once('secureConnect',()=>{
    try{assert(!this.closed,'This host connection is closed.',502);assert(socket.alpnProtocol==='h2'&&equalSecret(certificatePin(socket.getPeerCertificate().raw),this.fingerprint),'Agent identity changed. Verify the host and pair it again.',502);clearTimeout(timer);socket.off('error',failed);socket.off('close',closed);resolve();}
    catch(error){socket.destroy();failed(error);}
   });
  });
  // Keep a listener across the handoff to HTTP/2 as well.
  socket.on('error',()=>{});
  const session=http2.connect(this.origin,{createConnection:()=>socket,settings:{enablePush:false,maxConcurrentStreams:32}});this.sessions.add(session);
  session.on('error',()=>{});session.on('goaway',()=>session.destroy());
  session.once('close',()=>{this.sessions.delete(session);if(this.current===session)this.current=null;clearInterval(heartbeat);clearTimeout(deadline);this.reconnect();});
  let deadline;
  const heartbeat=setInterval(()=>{
   if(session.closed||session.destroyed||deadline)return;
   deadline=setTimeout(()=>session.destroy(Error('Agent heartbeat timed out.')),5000).unref();
   try{session.ping(error=>{clearTimeout(deadline);deadline=null;if(error)session.destroy();});}catch{session.destroy();}
  },this.pingInterval).unref();
  await new Promise((resolve,reject)=>{session.once('connect',resolve);session.once('error',reject);session.once('close',()=>reject(Error('Agent connection closed.')));});
  if(this.closed){session.destroy();throw Error('Host connection closed.');}
  this.current=session;this.failures=0;clearTimeout(this.retryTimer);this.retryTimer=null;return session;
 }
 async fetch(url,{method='GET',headers={},body,signal}={}){
  const target=new URL(url);assert(target.origin===this.origin.origin&&(target.pathname.startsWith('/remote/v1/')||target.pathname==='/health'),'Invalid agent destination.');
  signal?.throwIfAborted();const session=await new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal?.addEventListener('abort',abort,{once:true});this.session().then(resolve,reject).finally(()=>signal?.removeEventListener('abort',abort));});signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
   let stream,responded=false;try{stream=session.request({':method':method,':path':target.pathname+target.search,...headers,[http2.sensitiveHeaders]:['authorization']});}catch(error){reject(error);return;}
   const abort=()=>stream.destroy(signal.reason instanceof Error?signal.reason:Error('Agent request cancelled.'));
   signal?.addEventListener('abort',abort,{once:true});stream.once('close',()=>{signal?.removeEventListener('abort',abort);if(!responded)reject(Error('Agent connection was interrupted. Check its outcome before retrying.'));});
   stream.once('error',reject);stream.once('aborted',()=>stream.destroy(Error('Agent response was interrupted. Check its outcome before retrying.')));
   stream.once('response',incoming=>{
    try{responded=true;
    const status=Number(incoming[':status']),responseHeaders=new Headers();for(const key of ['content-type','content-disposition'])if(incoming[key])responseHeaders.set(key,String(incoming[key]));
    resolve(new Response([204,205,304].includes(status)?null:Readable.toWeb(stream,{strategy:{highWaterMark:65536,size:chunk=>chunk.byteLength}}),{status,headers:responseHeaders}));if([204,205,304].includes(status))stream.resume();
    }catch(error){stream.destroy();reject(error);}
   });stream.end(body);
  });
 }
 close(){this.closed=true;clearTimeout(this.retryTimer);this.socket?.destroy();for(const session of this.sessions)session.destroy();}
}
