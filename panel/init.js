import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Accounts} from './applications/factorio/accounts.js';

export async function initializePanel(root,address='http://localhost:8080',{recovery=false}={}){
  const url=new URL(address);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('PANEL_URL must be an HTTP(S) origin, such as http://localhost:8080.');
  for(const dir of ['auth','controller','secrets'])await fs.mkdir(path.join(root,dir),{recursive:true});
  const accounts=new Accounts(path.join(root,'auth'));
  const users=await accounts.users();
  let link=null;
  const tokenFile=path.join(root,'secrets/controller-token');
  const initialized=await fs.stat(tokenFile).catch(()=>null);
  // Repeated setup preserves the outstanding invitation, as well as accounts.
  if(recovery||!initialized&&!Object.keys(users).length){
    const invite=await accounts.invite('admin','Server setup',{bootstrap:true});
    link=`${url.origin}/#register=${invite.token}`;
    await fs.writeFile(path.join(root,'registration-link.txt'),`Create your administrator account:\n${link}\n\nThis private link can be used once and expires at ${new Date(invite.expires).toISOString()}.\n`,{mode:0o600});
  }
  if(!initialized)await fs.writeFile(tokenFile,crypto.randomBytes(48).toString('hex'),{mode:0o600,flag:'wx'});
  return {link};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=process.env.PANEL_INIT_DIR||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../.panel-data');
  const recovery=process.argv.includes('--registration-link')||process.argv.includes('--reset-passwords');
  const {link}=await initializePanel(root,process.env.PANEL_URL||'http://localhost:8080',{recovery});
  console.log(link||'Panel already initialized. Use --registration-link to issue a new administrator registration link.');
}
