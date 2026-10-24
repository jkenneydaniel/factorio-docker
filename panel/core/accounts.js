import crypto from 'node:crypto';
import path from 'node:path';
import {assert} from '../common.js';
import {AccountsRepository} from './storage/document-repository.js';
import {normalizeGrants,permissionCatalog} from './permissions.js';
import {hashPassword,checkPassword} from '../auth.js';

const summarizeAccess = user => ({role:user?.role||'removed',grants:structuredClone(user?.grants||{})});
function accessChange(before,after){
 const scopes=[...new Set([...Object.keys(before.grants),...Object.keys(after.grants)])];
 return {roles:[before.role,after.role],assignments:scopes.filter(scope=>JSON.stringify(before.grants[scope]||[])!==JSON.stringify(after.grants[scope]||[])).map(scope=>({scope,before:before.grants[scope]||[],after:after.grants[scope]||[]}))};
}
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
export class Accounts {
  constructor(root,{permissionCatalog:catalog=permissionCatalog,repository=new AccountsRepository(root)}={}){this.permissionCatalog=catalog;this.file=path.join(root,'users.json');this.repository=repository;this.queue=Promise.resolve();}
  transaction(action){
    const result=this.queue.then(()=>this.repository.transaction(action));
    this.queue=result.catch(()=>{});return result;
  }
  async onDelete(){}
  async deletionRecords(){return [];}
  users(){return this.transaction(state=>state.users);}
  list(){return this.transaction(state=>({users:Object.entries(state.users).map(([username,user])=>({username,role:user.role,created:user.created,...(user.role==='member'?{grants:user.grants||{},accessRevision:user.accessRevision||0}:{})})),invitations:Object.entries(state.invitations).filter(([,item])=>item.expires>Date.now()).map(([id,item])=>({id,role:item.role,expires:item.expires,createdBy:item.createdBy}))}));}
  invite(role,createdBy,{bootstrap=false}={}){
    assert(['admin','viewer','member'].includes(role),'Choose administrator, read-only or assigned-server access.');
    return this.transaction(async(state,save)=>{
      state.invitations=Object.fromEntries(Object.entries(state.invitations).filter(([,item])=>item.expires>Date.now()));
      assert(Object.keys(state.invitations).length<100,'Revoke an unused invitation before creating another.');
      const token=crypto.randomBytes(32).toString('base64url'),id=digest(token),expires=Date.now()+24*3600000;
      const invitation={role,createdBy,expires};
      if(bootstrap){
        // Retire only the unchanged generated accounts when the owner registers.
        invitation.retire=Object.fromEntries(Object.entries(state.users).filter(([name,user])=>['admin','viewer'].includes(name)&&!user.created).map(([name,user])=>[name,user.hash]));
        for(const [key,item] of Object.entries(state.invitations))if(item.retire)delete state.invitations[key];
      }
      state.invitations[id]=invitation;await save();return {token,role,expires};
    });
  }
  inspect(token){return this.transaction(state=>{const item=this.invitation(state,token);return {role:item.role,expires:item.expires,owner:!!item.retire};});}
  invitation(state,token){
    assert(typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token),'This invitation is invalid or expired.',400);
    const item=state.invitations[digest(token)];assert(item&&item.expires>Date.now(),'This invitation is invalid or expired.',400);return item;
  }
  async register({token,username,password}){
    assert(typeof username==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/.test(username),'Use 3–32 letters, numbers, underscores, or dashes for your username.');
    assert(typeof password==='string'&&password.length>=12&&password.length<=128,'Use a password between 12 and 128 characters.');
    return this.transaction(async(state,save)=>{
      const invitation=this.invitation(state,token);
      const retire=invitation.retire||{};
      assert(!Object.keys(state.users).some(name=>name.toLowerCase()===username.toLowerCase()&&!(retire[name]&&retire[name]===state.users[name].hash)),'That username is already in use.',409);
      assert(Object.keys(state.users).length<100,'The account limit has been reached.');
      for(const [name,hash] of Object.entries(retire))if(state.users[name]?.hash===hash)delete state.users[name];
      const user={...hashPassword(password),role:invitation.role,...(invitation.role==='member'?{grants:{},accessRevision:0}:{}),created:new Date().toISOString()};
      if(invitation.retire)user.onboarding={completed:false};
      state.users[username]=user;delete state.invitations[digest(token)];await save();return {username,role:user.role};
    });
  }
  revoke(id){return this.transaction(async(state,save)=>{assert(Object.hasOwn(state.invitations,id),'Invitation not found.',404);delete state.invitations[id];await save();return {ok:true};});}
  onboarding(username){return this.transaction(state=>state.users[username]?.onboarding||{completed:true});}
  completeOnboarding(username){return this.transaction(async(state,save)=>{
    assert(Object.hasOwn(state.users,username),'Account not found.',404);
    state.users[username].onboarding={completed:true,completedAt:new Date().toISOString()};await save();return state.users[username].onboarding;
  });}
  changePassword(username,currentPassword,password){return this.transaction(async(state,save)=>{
    assert(typeof currentPassword==='string'&&currentPassword.length<=256&&Object.hasOwn(state.users,username)&&checkPassword(currentPassword,state.users[username]),'Current password is incorrect.',403);
    assert(typeof password==='string'&&password.length>=12&&password.length<=128,'Use a password between 12 and 128 characters.');
    state.users[username]={...state.users[username],...hashPassword(password)};await save();return state.users[username];
  });}
  update({username,operation,role,grants,revision,confirm}){return this.transaction(async(state,save,storageSnapshot)=>{
    assert(confirm===true,'Confirm this account change.');
    assert(typeof username==='string'&&Object.hasOwn(state.users,username),'Account not found.',404);
    assert(['delete','role','grants'].includes(operation),'Unsupported account action.');
    if(operation==='role')assert(['admin','viewer','member'].includes(role),'Choose administrator, read-only or assigned-server access.');
    if(state.users[username].role==='admin'&&(operation==='delete'||role!=='admin'))assert(Object.values(state.users).filter(user=>user.role==='admin').length>1,'Keep at least one administrator account.',409);
    const before=summarizeAccess(state.users[username]);
    if(operation==='grants'){
      const user=state.users[username];
      assert(user.role==='member','Server assignments apply only to assigned-server accounts.');
      assert(Number.isSafeInteger(revision)&&revision===(user.accessRevision||0),'Access changed in another session. Reload accounts before saving.',409);
      user.grants=normalizeGrants(grants,this.permissionCatalog,user.grants||{});user.accessRevision=revision+1;
      await save();return {ok:true,accessChange:accessChange(before,summarizeAccess(user))};
    }
    const removed=state.users[username];
    if(operation==='delete')delete state.users[username];else {state.users[username].role=role;delete state.users[username].grants;state.users[username].accessRevision=(state.users[username].accessRevision||0)+1;if(role==='member')state.users[username].grants={};}
    await save(operation==='delete'?await this.deletionRecords(removed,storageSnapshot):[]);
    if(operation==='delete')await this.onDelete(removed,storageSnapshot);
    return {ok:true,accessChange:accessChange(before,summarizeAccess(state.users[username]))};
  });}
}
