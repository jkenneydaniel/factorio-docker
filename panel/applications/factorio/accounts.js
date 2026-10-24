import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {Accounts as CoreAccounts} from '../../core/accounts.js';
import {assert,readJSON,writeJSON} from '../../common.js';
import {emptySetups,changeSetups} from './world-setups.js';
import {WorldSetupsRepository} from './storage.js';
import {withStorageLock} from '../../core/storage/coordination.js';

export class Accounts extends CoreAccounts{
  worldSetups(username,body,scope){return this.transaction(async(state,save,storageSnapshot)=>{
    assert(Object.hasOwn(state.users,username),'Account not found.',404);
    const user=state.users[username];
    const file=id=>path.join(path.dirname(this.file),'world-setups',id+'.json');
    assert(scope===undefined||/^[a-f0-9]{32}$/.test(scope),'Invalid server scope.');
    const id=scope?user.serverWorldSetupIds?.[scope]:user.worldSetupId;
    if(storageSnapshot.store){
      const nextId=id||crypto.randomUUID(),repository=new WorldSetupsRepository(path.dirname(this.file),nextId),snapshot=await repository.read();
      if(body===undefined)return snapshot.value;
      const next=changeSetups(snapshot.value,body);
      if(!id){if(scope){user.serverWorldSetupIds??={};user.serverWorldSetupIds[scope]=nextId;}else user.worldSetupId=nextId;}
      await save([{repository,snapshot,value:next}]);return next;
    }
    if(body===undefined)return id?await readJSON(file(id),emptySetups()):emptySetups();
    return withStorageLock(path.dirname(this.file),'write',async()=>{
      const current=id?await readJSON(file(id),emptySetups()):emptySetups(),next=changeSetups(current,body);
      let nextId=id;if(!nextId){nextId=crypto.randomUUID();if(scope){user.serverWorldSetupIds??={};user.serverWorldSetupIds[scope]=nextId;}else user.worldSetupId=nextId;}
      await save();await writeJSON(file(nextId),next);return next;
    });
  });}
  async deletionRecords(user,snapshot){
    if(!snapshot.store)return [];
    const entries=[];
    for(const id of new Set([user.worldSetupId,...Object.values(user.serverWorldSetupIds||{})].filter(Boolean))){const repository=new WorldSetupsRepository(path.dirname(this.file),id);entries.push({repository,snapshot:await repository.read(),delete:true});}
    return entries;
  }
  async onDelete(user,snapshot){if(snapshot.store)return;for(const id of [user.worldSetupId,...Object.values(user.serverWorldSetupIds||{})].filter(Boolean))if(/^[a-f0-9-]{36}$/.test(id))await fs.rm(path.join(path.dirname(this.file),'world-setups',id+'.json'),{force:true});}
}
