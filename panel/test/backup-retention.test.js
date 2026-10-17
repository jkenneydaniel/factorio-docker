import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {BackupRetention,defaultRetention,retentionPolicy} from '../backup-retention.js';

const day=86400000;
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'backup-retention-')),backups=path.join(root,'backups');await fs.mkdir(backups);
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  let now=Date.parse('2026-10-16T12:00:00Z'),protectedNames=[],validations={};const removed=[];
  const options={root:backups,file:path.join(root,'retention.json'),now:()=>now,protectedNames:()=>protectedNames,validations:()=>validations,onDeleted:async names=>{removed.push(...names);for(const name of names)delete validations[name];}};
  const retention=new BackupRetention(options);await retention.init();
  async function archive(name,age){const target=path.join(backups,name);await fs.writeFile(target,'synthetic archive');const date=new Date(now-age*day);await fs.utimes(target,date,date);return name;}
  async function series(type,count=5){for(let i=0;i<count;i++)await archive(`copy-${i}-${type}.zip`,40+i);}
  return {retention,options,root,backups,archive,series,removed,setTime:value=>now=value,protect:names=>protectedNames=names,verify:async(name,valid=true)=>{const stat=await fs.stat(path.join(backups,name));validations[name]={ok:true,size:stat.size,modified:valid?stat.mtime.toISOString():'stale'};}};
}
test('backup retention starts disabled with bounded whole-day settings',async t=>{
  const {retention}=await fixture(t);assert.deepEqual(retention.status(),{policy:defaultRetention,revision:0,lastRun:null});assert.equal(retention.due,false);
  for(const value of [0,-1,3651,1.5,'30',null])assert.throws(()=>retentionPolicy({...defaultRetention,days:value}),/between/);
  assert.throws(()=>retentionPolicy({...defaultRetention,includeManual:'yes'}),/options/);
  assert.equal(retentionPolicy({...defaultRetention,days:3650}).days,3650);
});
test('age cleanup excludes manual and safety archives, preserves newest copies and exact cutoff',async t=>{
  const f=await fixture(t);await f.series('scheduled');await f.series('manual');await f.series('before-world-switch');
  await f.archive('boundary-scheduled.zip',30);await f.archive('young-scheduled.zip',1);await f.archive('younger-scheduled.zip',0);
  const plan=await f.retention.preview();assert.deepEqual(plan.candidates.map(f=>f.relative),Array.from({length:5},(_,i)=>`copy-${i}-scheduled.zip`));
  assert.ok(plan.protected.some(f=>f.relative==='boundary-scheduled.zip'&&f.reason==='Within retention window'));
  assert.ok(plan.protected.some(f=>f.relative==='copy-4-manual.zip'&&f.reason==='Manual backups excluded'));
  const result=await f.retention.cleanup(plan.id);assert.equal(result.deleted.length,5);assert.equal(f.removed.length,5);assert.equal(result.bytes,5*Buffer.byteLength('synthetic archive'));
});
test('optional cleanup of all types keeps two of each and leaves libraries, unknown files and unfinished ZIPs alone',async t=>{
  const f=await fixture(t);for(const type of ['scheduled','manual','before-settings-change'])await f.series(type);
  await f.archive('imported.zip',90);await f.archive('copy-scheduled.zip.tmp',90);await fs.mkdir(path.join(f.backups,'world-library.zip'));await fs.writeFile(path.join(f.root,'world.zip'),'world');
  const plan=await f.retention.preview({...defaultRetention,includeManual:true,includeSafety:true});assert.equal(plan.candidates.length,9);
  await f.retention.cleanup(plan.id);assert.equal((await fs.readdir(f.backups)).length,9);assert.equal(await fs.readFile(path.join(f.root,'world.zip'),'utf8'),'world');
  assert.ok(plan.protected.some(f=>f.relative==='imported.zip'&&/Unrecognized/.test(f.reason)));
});
test('most recent verified archive is kept even when old; stale verification does not protect another copy',async t=>{
  const f=await fixture(t);await f.series('scheduled');await f.verify('copy-3-scheduled.zip');await f.verify('copy-4-scheduled.zip',false);
  const plan=await f.retention.preview();assert.deepEqual(plan.candidates.map(f=>f.relative),['copy-2-scheduled.zip','copy-4-scheduled.zip']);
  assert.match(plan.protected.find(f=>f.relative==='copy-3-scheduled.zip').reason,/verified/);
});
test('pending update recovery protects a copy and newly required recovery invalidates a review',async t=>{
  const f=await fixture(t);await f.series('scheduled');f.protect(['copy-4-scheduled.zip']);
  const plan=await f.retention.preview();assert.ok(!plan.candidates.some(f=>f.relative==='copy-4-scheduled.zip'));
  f.protect(['copy-3-scheduled.zip','copy-4-scheduled.zip']);await assert.rejects(f.retention.cleanup(plan.id),/protection changed/);assert.equal(f.removed.length,0);
});
test('changed archive contents, replacement identities and added or removed files require a new review',async t=>{
  const f=await fixture(t);await f.series('scheduled');let plan=await f.retention.preview();
  await fs.writeFile(path.join(f.backups,'copy-2-scheduled.zip'),'changed');await assert.rejects(f.retention.cleanup(plan.id),/changed/);
  plan=await f.retention.preview();const target=path.join(f.backups,'copy-3-scheduled.zip'),stat=await fs.stat(target);
  await fs.rename(target,target+'.old');await fs.writeFile(target,'synthetic archive');await fs.utimes(target,stat.atime,stat.mtime);await assert.rejects(f.retention.cleanup(plan.id),/changed/);
  plan=await f.retention.preview();await f.archive('new-scheduled.zip',2);await assert.rejects(f.retention.cleanup(plan.id),/changed/);
  plan=await f.retention.preview();await fs.unlink(target);await assert.rejects(f.retention.cleanup(plan.id),/changed/);assert.equal(f.removed.length,0);
});
test('cleanup reviews expire, cannot be invented or replayed, and cannot accept file paths',async t=>{
  const f=await fixture(t);await f.series('scheduled');let plan=await f.retention.preview();
  await assert.rejects(f.retention.cleanup('../../world.zip'),/expired/);await f.retention.cleanup(plan.id);await assert.rejects(f.retention.cleanup(plan.id),/expired/);
  plan=await f.retention.preview();f.setTime(Date.parse(plan.expires));await assert.rejects(f.retention.cleanup(plan.id),/expired/);
});
test('symlinks are excluded and a reviewed archive replaced by a symlink invalidates cleanup',async t=>{
  const f=await fixture(t);await f.series('scheduled');const outside=path.join(f.root,'outside.zip');await fs.writeFile(outside,'keep me');
  try{await fs.symlink(outside,path.join(f.backups,'linked-manual.zip'));}catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('Host does not allow symbolic links.');return;}throw error;}
  const plan=await f.retention.preview();assert.ok(!JSON.stringify(plan).includes('linked-manual'));
  await fs.unlink(path.join(f.backups,'copy-4-scheduled.zip'));await fs.symlink(outside,path.join(f.backups,'copy-4-scheduled.zip'));
  await assert.rejects(f.retention.cleanup(plan.id),/changed/);assert.equal(await fs.readFile(outside,'utf8'),'keep me');assert.equal(f.removed.length,0);
});
test('daily cleanup requires explicit confirmed review, persists, and follows the configured clock window',async t=>{
  const f=await fixture(t);await f.series('scheduled');const policy={...defaultRetention,enabled:true,days:14};
  await assert.rejects(f.retention.configure(policy,{revision:0}),/Confirm/);
  const plan=await f.retention.preview(policy);await assert.rejects(f.retention.configure({...policy,days:15},{revision:0,planId:plan.id,confirm:true}),/Review this policy/);
  await f.retention.configure(policy,{revision:0,planId:plan.id,confirm:true});assert.equal(f.removed.length,0,'enabling only saves the policy');assert.equal(f.retention.due,true);
  await f.retention.cleanup((await f.retention.preview()).id);await f.retention.ran();assert.equal(f.retention.due,false);
  const restarted=new BackupRetention(f.options);await restarted.init();assert.deepEqual(restarted.status(),f.retention.status());assert.equal(restarted.due,false);
  const last=Date.parse(f.retention.status().lastRun);f.setTime(last+day-1);assert.equal(f.retention.due,false);f.setTime(last+day);assert.equal(f.retention.due,true);
  await f.retention.configure({...policy,enabled:false},{revision:1});assert.equal(f.retention.due,false);
});
test('concurrent administrators cannot overwrite a policy with the same revision',async t=>{
  const f=await fixture(t);const result=await Promise.allSettled([f.retention.configure({...defaultRetention,days:7},{revision:0}),f.retention.configure({...defaultRetention,days:90},{revision:0})]);
  assert.equal(result[0].status,'fulfilled');assert.equal(result[1].status,'rejected');assert.match(result[1].reason.message,/another session/);assert.equal(f.retention.status().policy.days,7);
});
test('scheduled count retention uses the same protections and never deletes other backup categories',async t=>{
  const f=await fixture(t);await f.series('scheduled',7);await f.series('manual');await f.series('before-game-update');await f.verify('copy-5-scheduled.zip');f.protect(['copy-6-scheduled.zip']);
  const result=await f.retention.pruneScheduled(3);assert.deepEqual(result.deleted,['copy-3-scheduled.zip','copy-4-scheduled.zip']);
  assert.equal((await fs.readdir(f.backups)).length,15);
});
test('changing the policy invalidates open cleanup reviews',async t=>{
  const f=await fixture(t);await f.series('scheduled');const plan=await f.retention.preview();await f.retention.configure({...defaultRetention,days:90},{revision:0});
  await assert.rejects(f.retention.cleanup(plan.id),/expired/);assert.equal(f.removed.length,0);
});
test('partial filesystem failure reports the deleted count and prunes only deleted validation records',async t=>{
  const f=await fixture(t);await f.series('scheduled');const plan=await f.retention.preview(),unlink=fs.unlink;
  t.mock.method(fs,'unlink',async target=>{if(target.endsWith('copy-3-scheduled.zip'))throw new Error('Synthetic storage failure');return unlink(target);});
  await assert.rejects(f.retention.cleanup(plan.id),/stopped after deleting 1.*Synthetic storage failure/);
  assert.deepEqual(f.removed,['copy-2-scheduled.zip']);assert.ok((await fs.readdir(f.backups)).includes('copy-3-scheduled.zip'));
});
