import crypto from 'node:crypto';
import path from 'node:path';
import {readJSON,writeJSON,assert} from './common.js';
import {hashPassword,checkPassword} from './auth.js';

const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
export class Accounts {
  constructor(root){this.file=path.join(root,'users.json');this.queue=Promise.resolve();}
  transaction(action){
    const result=this.queue.then(async()=>{
      const value=await readJSON(this.file,{});
      const state=value.version===2?value:{version:2,users:value,invitations:{}};
      return action(state,()=>writeJSON(this.file,state));
    });
    this.queue=result.catch(()=>{});return result;
  }
  users(){return this.transaction(state=>state.users);}
  list(){return this.transaction(state=>({users:Object.entries(state.users).map(([username,user])=>({username,role:user.role,created:user.created})),invitations:Object.entries(state.invitations).filter(([,item])=>item.expires>Date.now()).map(([id,item])=>({id,role:item.role,expires:item.expires,createdBy:item.createdBy}))}));}
  invite(role,createdBy,{bootstrap=false}={}){
    assert(['admin','viewer'].includes(role),'Choose administrator or read-only access.');
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
  inspect(token){return this.transaction(state=>{const item=this.invitation(state,token);return {role:item.role,expires:item.expires};});}
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
      const user={...hashPassword(password),role:invitation.role,created:new Date().toISOString()};
      state.users[username]=user;delete state.invitations[digest(token)];await save();return {username,role:user.role};
    });
  }
  revoke(id){return this.transaction(async(state,save)=>{assert(Object.hasOwn(state.invitations,id),'Invitation not found.',404);delete state.invitations[id];await save();return {ok:true};});}
  changePassword(username,currentPassword,password){return this.transaction(async(state,save)=>{
    assert(typeof currentPassword==='string'&&currentPassword.length<=256&&Object.hasOwn(state.users,username)&&checkPassword(currentPassword,state.users[username]),'Current password is incorrect.',403);
    assert(typeof password==='string'&&password.length>=12&&password.length<=128,'Use a password between 12 and 128 characters.');
    state.users[username]={...state.users[username],...hashPassword(password)};await save();return state.users[username];
  });}
  update({username,operation,role,confirm}){return this.transaction(async(state,save)=>{
    assert(confirm===true,'Confirm this account change.');
    assert(typeof username==='string'&&Object.hasOwn(state.users,username),'Account not found.',404);
    assert(['delete','role'].includes(operation),'Unsupported account action.');
    if(operation==='role')assert(['admin','viewer'].includes(role),'Choose administrator or read-only access.');
    if(state.users[username].role==='admin'&&(operation==='delete'||role!=='admin'))assert(Object.values(state.users).filter(user=>user.role==='admin').length>1,'Keep at least one administrator account.',409);
    if(operation==='delete')delete state.users[username];else state.users[username].role=role;
    await save();return {ok:true};
  });}
}
