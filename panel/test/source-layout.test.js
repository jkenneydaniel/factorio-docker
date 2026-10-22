import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sourceFile,installationPath} from '../source-layout.js';
import {sourceSnapshot,publicSource,assertUnmodified} from '../update-source.js';

test('organized source snapshots detect edits without expanding the installed archive allowlist',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'goblin-layout-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const files=['images/factorio/Dockerfile','images/rust/entrypoint.mjs','scripts/standalone/Setup.sh','deploy/fleet/.env.example'];
  for(const name of [...files,'.env','data/world.zip','scripts/private.env']){
    const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'fixture');
  }
  const baseline={format:1,files:await sourceSnapshot(root)};
  assert.deepEqual(Object.keys(baseline.files).sort(),files.sort());
  for(const name of files){assert.equal(publicSource(name),false);assert.equal(publicSource(installationPath(name)),true);}
  await assertUnmodified(root,baseline);
  await fs.writeFile(path.join(root,files[0]),'local change');
  await assert.rejects(assertUnmodified(root,baseline),/local changes/);
  await fs.symlink(path.join(root,'.env'),path.join(root,'images/rust/private.json'));
  await assert.rejects(sourceSnapshot(root),/symlink/);
});

test('source lookup supports organized checkouts and extracted historical layouts',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'goblin-layout-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,'fleet.compose.yaml'),'historical');
  assert.equal(await fs.readFile(await sourceFile(root,'fleet.compose.yaml'),'utf8'),'historical');
  await fs.mkdir(path.join(root,'deploy/fleet'),{recursive:true});
  await fs.writeFile(path.join(root,'deploy/fleet/compose.yaml'),'organized');
  assert.equal(await fs.readFile(await sourceFile(root,'fleet.compose.yaml'),'utf8'),'organized');
});
