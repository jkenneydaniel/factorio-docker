import crypto from 'node:crypto';
import {assert,equalSecret,HttpError} from './common.js';

export function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){
  return {salt,hash:crypto.scryptSync(password,salt,64).toString('hex')};
}
export function checkPassword(password,record){
  return !!record&&equalSecret(crypto.scryptSync(String(password),record.salt,64).toString('hex'),record.hash);
}
export function checkOrigin(req,allowedHosts){
  let host;try{host=new URL(`http://${req.headers.host}`).hostname.toLowerCase();}catch{throw new HttpError(400,'Invalid host.');}
  assert(allowedHosts.includes(host),'This hostname is not allowed for the local panel.',403);
  if(!['GET','HEAD'].includes(req.method))assert(req.headers.origin===`http://${req.headers.host}`,'Request origin does not match this panel.',403);
}
export function requireAdmin(session){assert(session.role==='admin','Administrator access is required.',403);}
