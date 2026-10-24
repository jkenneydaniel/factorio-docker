import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setup} from '../setup.js';
import {Accounts} from '../applications/factorio/accounts.js';
import {makeZip} from '../core/archive.js';

const options={log:()=>{},url:'http://factory.example:8080'};
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'factory-setup-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('new setup creates LAN configuration, a usable invitation and stable secrets on rerun',async t=>{
  const root=await fixture(t),result=await setup(root,['--new-world'],options);
  assert.ok(result.link.startsWith('http://factory.example:8080/#register='));
  const accounts=new Accounts(path.join(root,'.panel-data/auth'));
  const token=result.link.split('=')[1];assert.equal((await accounts.inspect(token)).role,'admin');
  const secret=await fs.readFile(path.join(root,'.panel-data/secrets/controller-token'),'utf8');
  const config=JSON.parse(await fs.readFile(path.join(root,'data/config/server-settings.json'),'utf8'));
  assert.equal(config.visibility.public,false);assert.equal(config.auto_pause,true);assert.equal(config.require_user_verification,false);
  assert.deepEqual(await fs.readdir(path.join(root,'data/saves')),[]);
  assert.equal((await setup(root,['--new-world'],options)).link,null);
  assert.equal(await fs.readFile(path.join(root,'.panel-data/secrets/controller-token'),'utf8'),secret);
  await accounts.register({token,username:'Owner',password:'a long setup test password'});
  const recovered=await setup(root,['--registration-link'],options);
  assert.equal((await accounts.inspect(recovered.link.split('=')[1])).role,'admin');
  assert.deepEqual(Object.keys(await accounts.users()),['Owner']);
});
test('import validates CRC and preserves originals; setup cannot replace existing worlds or config',async t=>{
  const root=await fixture(t),source=path.join(root,'world.zip');
  const zip=makeZip([{name:'Factory/level.dat0',data:Buffer.from('test world')}]);
  await fs.writeFile(source,zip);await setup(root,['--save',source],options);
  assert.deepEqual(await fs.readFile(path.join(root,'data/saves/Imported-world.zip')),zip);
  assert.deepEqual(await fs.readFile(source),zip);
  const config=path.join(root,'data/config/server-settings.json');await fs.writeFile(config,'{"name":"Keep me"}');
  await setup(root,[],options);assert.equal(await fs.readFile(config,'utf8'),'{"name":"Keep me"}');
  await assert.rejects(setup(root,['--save',source],options),/Existing saves/);
  const second=await fixture(t),bad=Buffer.from(zip);bad[30+Buffer.byteLength('Factory/level.dat0')]^=255;
  await fs.writeFile(path.join(second,'bad.zip'),bad);
  await assert.rejects(setup(second,['--save','bad.zip'],options),/integrity/);
  await assert.rejects(fs.stat(path.join(second,'.panel-data')),/ENOENT/);
});
test('setup requires explicit first-run choice, rejects unsafe paths and preserves incomplete state',async t=>{
  const root=await fixture(t);
  await assert.rejects(setup(root,[],options),/Choose/);
  await assert.rejects(setup(root,['--save'],options),/Use/);
  await assert.rejects(setup(root,['--new-world','--save','foo'],options),/Use/);
  await assert.rejects(setup(root,['--new-world'],{...options,url:'file:///tmp'}),/HTTP/);
  await fs.mkdir(path.join(root,'.panel-data/auth'),{recursive:true});await fs.writeFile(path.join(root,'.panel-data/auth/users.json'),'{}');
  await assert.rejects(setup(root,['--new-world'],options),/Incomplete/);
  await fs.rm(path.join(root,'.panel-data'),{recursive:true});
  await fs.mkdir(path.join(root,'other'));await fs.symlink(path.join(root,'other'),path.join(root,'data'),'junction');
  await assert.rejects(setup(root,['--new-world'],options),/symlink/);
});
test('Linux setup gives new auth/controller files their service UIDs and a readable shared key',{skip:process.getuid?.()!==0},async t=>{
  const root=await fixture(t);
  await setup(root,['--new-world'],{...options,ownership:true});
  assert.equal((await fs.stat(path.join(root,'.panel-data/auth/users.json'))).uid,1000);
  assert.equal((await fs.stat(path.join(root,'.panel-data/controller'))).uid,845);
  assert.equal((await fs.stat(path.join(root,'data/config/server-settings.json'))).uid,845);
  assert.equal((await fs.stat(path.join(root,'.panel-data/secrets/controller-token'))).mode&0o777,0o444);
  assert.equal((await fs.stat(path.join(root,'.panel-data/secrets'))).mode&0o777,0o700);
  const token=await fs.readFile(path.join(root,'.panel-data/secrets/controller-token'),'utf8');
  await setup(root,['--registration-link'],{...options,ownership:true});
  assert.equal((await fs.stat(path.join(root,'.panel-data/auth/users.json'))).uid,1000);
  assert.equal(await fs.readFile(path.join(root,'.panel-data/secrets/controller-token'),'utf8'),token);
});
