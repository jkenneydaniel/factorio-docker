import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Accounts} from '../accounts.js';
import {hashPassword,checkPassword} from '../auth.js';

test('registration survives restart, consumes invitations once, and preserves account roles',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'factorio-accounts-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const accounts=new Accounts(root),invite=await accounts.invite('viewer','Owner');
  assert.equal((await accounts.inspect(invite.token)).role,'viewer');
  assert.ok(!(await fs.readFile(path.join(root,'users.json'),'utf8')).includes(invite.token));
  const input={token:invite.token,username:'Engineer',password:'a long test password',role:'admin'};
  const results=await Promise.allSettled([accounts.register(input),accounts.register({...input,username:'OtherEngineer'})]);
  assert.equal(results.filter(item=>item.status==='fulfilled').length,1);
  assert.equal(results[0].value.role,'viewer');
  const restarted=new Accounts(root),users=await restarted.users();assert.equal(users.Engineer.role,'viewer');assert.ok(checkPassword(input.password,users.Engineer));
  await assert.rejects(restarted.inspect(invite.token),/invalid or expired/);
  const second=await restarted.invite('admin','Owner');
  await assert.rejects(restarted.register({...input,token:second.token,username:'engineer'}),/already in use/);
  await assert.rejects(restarted.register({...input,token:second.token,password:'short'}),/12 and 128/);
  await assert.rejects(restarted.register({...input,token:second.token,username:'__proto__'}),/username/);
  const list=await restarted.list();assert.equal(list.invitations.length,1);assert.equal(list.users[0].hash,undefined);
  await restarted.revoke(list.invitations[0].id);await assert.rejects(restarted.inspect(second.token),/invalid or expired/);
});

test('owner claim retires only unchanged legacy generated accounts and expired invitations fail',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'factorio-owner-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const existing={admin:{...hashPassword('legacy password'),role:'admin'},viewer:{...hashPassword('viewer password'),role:'viewer'},Custom:{...hashPassword('custom password'),role:'admin'}};
  await fs.writeFile(path.join(root,'users.json'),JSON.stringify(existing));
  const accounts=new Accounts(root),invite=await accounts.invite('admin','Setup',{bootstrap:true});
  await accounts.register({token:invite.token,username:'TestOwner',password:'my chosen long password'});
  assert.deepEqual(Object.keys(await accounts.users()).sort(),['Custom','TestOwner']);
  const next=await accounts.invite('admin','Setup',{bootstrap:true});
  await accounts.register({token:next.token,username:'admin',password:'another long password'});
  const again=await accounts.invite('admin','Setup',{bootstrap:true});
  await accounts.register({token:again.token,username:'Another',password:'another long password'});
  assert.ok((await accounts.users()).admin,'registered admin survives later recovery links');
  const expired=await accounts.invite('viewer','TestOwner');
  const stored=JSON.parse(await fs.readFile(path.join(root,'users.json'),'utf8'));
  for(const invitation of Object.values(stored.invitations))invitation.expires=Date.now()-1;
  await fs.writeFile(path.join(root,'users.json'),JSON.stringify(stored));
  await assert.rejects(accounts.register({token:expired.token,username:'Late',password:'long enough password'}),/invalid or expired/);
});

test('account updates preserve an administrator and password changes require the old password',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'factorio-access-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const accounts=new Accounts(root),invite=await accounts.invite('admin','Setup');
  await accounts.register({token:invite.token,username:'Owner',password:'original long password'});
  await assert.rejects(accounts.update({username:'Owner',operation:'delete',confirm:true}),/at least one/);
  await assert.rejects(accounts.update({username:'Owner',operation:'role',role:'viewer',confirm:true}),/at least one/);
  await assert.rejects(accounts.changePassword('Owner','incorrect','replacement long password'),/Current password/);
  const record=await accounts.changePassword('Owner','original long password','replacement long password');assert.ok(checkPassword('replacement long password',record));assert.equal(checkPassword('original long password',record),false);
  const other=await accounts.invite('admin','Owner');await accounts.register({token:other.token,username:'Second',password:'a second long password'});
  await accounts.update({username:'Second',operation:'role',role:'viewer',confirm:true});assert.equal((await accounts.users()).Second.role,'viewer');
  await assert.rejects(accounts.update({username:'Second',operation:'delete'}),/Confirm/);
  await accounts.update({username:'Second',operation:'delete',confirm:true});assert.equal((await accounts.users()).Second,undefined);
});
