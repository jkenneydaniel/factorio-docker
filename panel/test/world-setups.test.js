import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Accounts} from '../applications/factorio/accounts.js';
import {emptySetups,changeSetups,validateDraft} from '../applications/factorio/world-setups.js';
const configuration=JSON.parse(await fs.readFile(new URL('../world-defaults.json',import.meta.url)));
const draft=()=>({name:'Copper Coast',seed:'12345',image:'test:2.0.77',base:'defaults',step:2,configuration:JSON.stringify(configuration),advanced:'{ unfinished',advancedDirty:true,inputs:{'map_gen_settings.starting_area':''},preview:true,activate:true});
test('unfinished drafts retain exact input, enforce bounds, and never restore activation',()=>{
  const value=validateDraft(draft());assert.equal(value.advanced,'{ unfinished');assert.equal(value.inputs['map_gen_settings.starting_area'],'');assert.equal(value.activate,false);
  assert.throws(()=>validateDraft({...draft(),configuration:'{broken'}),/Invalid draft configuration/);
  assert.throws(()=>validateDraft({...draft(),configuration:'{"map_gen_settings":[],"map_settings":{}}'}),/terrain and gameplay/);
  assert.throws(()=>validateDraft({...draft(),advanced:'x'.repeat(131073)}),/Invalid draft settings/);
  assert.throws(()=>validateDraft({...draft(),inputs:{'__proto__.bad':'x'}}),/Invalid draft input/);
});
test('presets validate settings, omit identity and seed, prevent duplicates and cap storage',()=>{
  const settings=structuredClone(configuration);settings.map_gen_settings.seed=42;
  const body={operation:'save-preset',name:'Railway evening',configuration:settings,image:'test:2.0.77',seed:'123',activate:true};
  let state=changeSetups(emptySetups(),{...body,revision:0});const preset=state.presets[0];
  assert.equal(preset.configuration.map_gen_settings.seed,undefined);assert.equal(preset.seed,undefined);assert.equal(preset.activate,undefined);
  assert.throws(()=>changeSetups(state,{...body,name:'railway EVENING',revision:1}),/already uses/);
  assert.throws(()=>changeSetups(state,{...body,revision:1,name:'Invalid',configuration:{map_gen_settings:{starting_area:-1},map_settings:{}}}),/starting area/);
  for(let i=1;i<20;i++)state=changeSetups(state,{...body,revision:state.revision,name:'Preset '+i});
  assert.throws(()=>changeSetups(state,{...body,revision:state.revision,name:'One too many'}),/up to 20/);
  state=changeSetups(state,{operation:'delete-preset',id:preset.id,revision:state.revision});assert.equal(state.presets.length,19);
});
test('revision and draft identities prevent stale tabs and completed jobs deleting newer work',()=>{
  const first=changeSetups(emptySetups(),{operation:'draft',revision:0,draft:draft()});
  assert.throws(()=>changeSetups(first,{operation:'draft',revision:0,draft:draft()}),/another tab/);
  const second=changeSetups(first,{operation:'draft',revision:1,draft:{...draft(),name:'Newer work'}});
  assert.throws(()=>changeSetups(second,{operation:'discard',revision:2,draftId:first.draft.id}),/newer draft/);
  const cleared=changeSetups(second,{operation:'discard',revision:2,draftId:second.draft.id});assert.equal(cleared.draft,null);
});
test('account setups survive restarts and passwords, stay private, and cannot reappear after account deletion',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'factorio-setups-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const accounts=new Accounts(root);
  for(const username of ['Owner','Other']){const invite=await accounts.invite('admin','Setup');await accounts.register({token:invite.token,username,password:'long enough test password'});}
  await accounts.worldSetups('Owner',{operation:'draft',revision:0,draft:draft()});
  assert.deepEqual(await accounts.worldSetups('Other'),emptySetups());
  assert.equal((await new Accounts(root).worldSetups('Owner')).draft.name,'Copper Coast');
  const userFile=await fs.readFile(path.join(root,'users.json'),'utf8');assert.ok(!userFile.includes('Copper Coast'),'large drafts are separate from credentials and session reads');
  await accounts.changePassword('Owner','long enough test password','replacement test password');assert.equal((await accounts.worldSetups('Owner')).revision,1);
  const writes=await Promise.allSettled([accounts.worldSetups('Owner',{operation:'draft',revision:1,draft:draft()}),accounts.worldSetups('Owner',{operation:'draft',revision:1,draft:draft()})]);assert.equal(writes.filter(r=>r.status==='fulfilled').length,1);
  await accounts.update({username:'Owner',operation:'delete',confirm:true});assert.equal((await fs.readdir(path.join(root,'world-setups'))).length,0);
  const invite=await accounts.invite('admin','Other');await accounts.register({token:invite.token,username:'Owner',password:'a recreated test password'});assert.deepEqual(await accounts.worldSetups('Owner'),emptySetups());
});
