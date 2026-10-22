import crypto from 'node:crypto';
import {assert} from '../common.js';
export const fingerprint=key=>'SHA256:'+crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/,'');

export async function probeSSH(options){
 const {Client}=(await import('ssh2')).default;
 return new Promise((resolve,reject)=>{
  const client=new Client();let found;
  client.on('error',()=>{client.destroy();if(found)resolve(found);else reject(Object.assign(Error('Could not read the SSH fingerprint. Check the SSH address, port and network.'),{status:502}));});
  client.connect({...options,readyTimeout:10000,hostVerifier:key=>{found=fingerprint(key);return false;}});
 });
}
export async function runSSH(options,script){
 const {Client}=(await import('ssh2')).default;
 assert(options.password||options.privateKey,'Enter an SSH password or private key.');
 assert(!options.password||typeof options.password==='string'&&options.password.length<=1024,'Invalid SSH password.');
 assert(!options.privateKey||typeof options.privateKey==='string'&&options.privateKey.length<=65536,'Invalid SSH private key.');
 assert(!options.passphrase||typeof options.passphrase==='string'&&options.passphrase.length<=1024,'Invalid key passphrase.');
 return new Promise((resolve,reject)=>{
  const client=new Client();let settled=false,keyChanged=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);client.destroy();error?reject(error):resolve(value);};
  const fail=message=>Object.assign(Error(message),{status:502});
  const timer=setTimeout(()=>finish(fail('Host setup timed out. Its partial installation was preserved; inspect the host before retrying.')),30*60000).unref();
  client.on('error',()=>finish(fail(keyChanged?'The SSH fingerprint changed. Review the host again before installing.':'SSH login or setup connection failed. Check the login and inspect the host before retrying.')));
  client.on('close',()=>{if(!settled)finish(fail('SSH disconnected before setup finished. Check the host before retrying.'));});
  client.on('ready',()=>client.exec(options.useSudo?'sudo -n sh -s':'sh -s',(error,stream)=>{
   if(error)return finish(fail('Could not start host setup over SSH.'));
   const chunks=[];let size=0;
   stream.on('data',chunk=>{size+=chunk.length;if(size>2*1024**2)return finish(fail('Host setup produced too much output. Inspect the host before retrying.'));chunks.push(chunk);});
   stream.stderr.on('data',()=>{}); // Never persist remote output or credentials.
   stream.on('error',()=>finish(fail('Host setup stopped unexpectedly. Inspect the host before retrying.')));
   stream.on('close',code=>code===0?finish(null,Buffer.concat(chunks).toString()):finish(fail('Host setup failed. Check Docker, the agent address/port and root or passwordless sudo access. Its files were retained for inspection.')));
   stream.end(script);
  }));
  try{client.connect({host:options.host,port:options.port,username:options.username,password:options.password,privateKey:options.privateKey,passphrase:options.passphrase,readyTimeout:15000,keepaliveInterval:15000,keepaliveCountMax:3,hostVerifier:key=>{keyChanged=fingerprint(key)!==options.fingerprint;return !keyChanged;}});}catch{finish(fail('Invalid SSH login or private key.'));}
 });
}
