import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {assert} from '../common.js';

const execute=promisify(execFile);
export const certificatePin=cert=>crypto.createHash('sha256').update(new crypto.X509Certificate(cert).raw).digest('hex');
export function pairingCode(value){
 const match=typeof value==='string'&&value.trim().match(/^(?:lg1\.([a-f0-9]{64})\.)?([A-Za-z0-9_-]{43})$/);
 assert(match,'Enter the complete, current pairing code.');return {fingerprint:match[1],secret:match[2],code:value.trim()};
}
export async function readAgentIdentity(webRoot){
 const directory=path.join(webRoot,'secrets/agent-identity');
 for(const file of [directory,path.join(directory,'key.pem'),path.join(directory,'cert.pem')]){
  const stat=await fs.lstat(file);assert(!stat.isSymbolicLink()&&(file===directory?stat.isDirectory():stat.isFile()),'Invalid stored agent identity. Restore its original files before starting.');
 }
 const key=await fs.readFile(path.join(directory,'key.pem')),cert=await fs.readFile(path.join(directory,'cert.pem'));
 const publicKey=crypto.createPublicKey(key).export({type:'spki',format:'der'}),certificate=new crypto.X509Certificate(cert);
 assert(publicKey.equals(certificate.publicKey.export({type:'spki',format:'der'})),'Agent identity key and certificate do not match.');
 return {key,cert,fingerprint:certificatePin(cert)};
}
// The certificate is a durable pairing identity, not a public Web PKI identity.
// Never rotate it silently: existing panels must fail closed if it changes.
export async function ensureAgentIdentity(webRoot){
 const secrets=path.join(webRoot,'secrets'),directory=path.join(secrets,'agent-identity');await fs.mkdir(secrets,{recursive:true,mode:0o700});
 let existing;try{existing=await fs.lstat(directory);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(existing)return readAgentIdentity(webRoot);
 const temporary=await fs.mkdtemp(path.join(secrets,'.agent-identity-'));await fs.chmod(temporary,0o700);
 try{
  await execute('openssl',['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-sha256','-nodes','-days','3650','-subj','/CN=Lobby Goblin host agent','-keyout',path.join(temporary,'key.pem'),'-out',path.join(temporary,'cert.pem')],{timeout:15000,maxBuffer:65536});
  await fs.chmod(path.join(temporary,'key.pem'),0o600);await fs.chmod(path.join(temporary,'cert.pem'),0o600);
  await fs.rename(temporary,directory);
 }finally{await fs.rm(temporary,{recursive:true,force:true});}
 return readAgentIdentity(webRoot);
}
