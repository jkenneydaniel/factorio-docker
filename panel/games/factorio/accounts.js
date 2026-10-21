import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {Accounts as CoreAccounts} from '../../core/accounts.js';
import {assert,readJSON,writeJSON} from '../../common.js';
import {emptySetups,changeSetups} from './world-setups.js';

export class Accounts extends CoreAccounts{
  worldSetups(username,body,scope){return this.transaction(async(state,save)=>{
    assert(Object.hasOwn(state.users,username),'Account not found.',404);
    const user=state.users[username];
    const file=id=>path.join(path.dirname(this.file),'world-setups',id+'.json');
    assert(scope===undefined||/^[a-f0-9]{32}$/.test(scope),'Invalid server scope.');
    const id=scope?user.serverWorldSetupIds?.[scope]:user.worldSetupId;
    const current=id?await readJSON(file(id),emptySetups()):emptySetups();
    if(body===undefined)return current;
    const next=changeSetups(current,body);
    let nextId=id;if(!nextId){nextId=crypto.randomUUID();if(scope){user.serverWorldSetupIds??={};user.serverWorldSetupIds[scope]=nextId;}else user.worldSetupId=nextId;await save();}
    await writeJSON(file(nextId),next);return next;
  });}
  async onDelete(user){for(const id of [user.worldSetupId,...Object.values(user.serverWorldSetupIds||{})].filter(Boolean))if(/^[a-f0-9-]{36}$/.test(id))await fs.rm(path.join(path.dirname(this.file),'world-setups',id+'.json'),{force:true});}
}
