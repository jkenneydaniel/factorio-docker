import crypto from 'node:crypto';
import {assert,equalSecret,HttpError} from './common.js';

export function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){
  return {salt,hash:crypto.scryptSync(password,salt,64).toString('hex')};
}
export function checkPassword(password,record){
  return !!record&&equalSecret(crypto.scryptSync(String(password),record.salt,64).toString('hex'),record.hash);
}
export function panelOrigin(value){
  if(!value)return null;
  const url=new URL(value);
  assert(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash,'PANEL_ORIGIN must be an HTTP(S) origin.');
  return url.origin;
}
export function checkOrigin(req,allowedHosts,expectedOrigin=null){
  let host;try{host=new URL(`http://${req.headers.host}`).hostname.toLowerCase();}catch{throw new HttpError(400,'Invalid host.');}
  assert(allowedHosts.includes(host),'This hostname is not allowed for the local panel.',403);
  // A declared origin supports HTTPS termination without trusting forwarded
  // headers supplied by a client. Default LAN behavior remains unchanged.
  if(expectedOrigin)assert(req.headers.host.toLowerCase()===new URL(expectedOrigin).host.toLowerCase(),'Request host does not match this panel.',403);
  if(!['GET','HEAD'].includes(req.method))assert(req.headers.origin===(expectedOrigin||`http://${req.headers.host}`),'Request origin does not match this panel.',403);
}
export function requireAdmin(session){assert(session.role==='admin','Administrator access is required.',403);}
