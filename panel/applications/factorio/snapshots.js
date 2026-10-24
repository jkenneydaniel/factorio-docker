import {runtimeReceipt,softwareIdentity} from './runtime.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {assert} from '../../common.js';
import {zipEntries} from '../../core/archive.js';
import {safeSnapshotPath} from '../../core/snapshot-files.js';
import {validateWorld} from './world-archive.js';

export async function collectSnapshot({backup, content}) {
  const entries = zipEntries(await fs.readFile(backup));
  const manifest = JSON.parse(
    entries.find((entry) => entry.name === 'panel-manifest.json')?.read() ||
      '{}',
  );
  assert(
    typeof manifest.activeSave === 'string' &&
      !manifest.activeSave.includes('/') &&
      !manifest.activeSave.includes('\\'),
    'Backup has no active world.',
  );
  const world = entries.find(
    (entry) => entry.name === 'saves/' + manifest.activeSave,
  );
  assert(world, 'Backup has no active world.');
  if(manifest.software){const software=softwareIdentity(runtimeReceipt(manifest.software));await fs.writeFile(path.join(content,'software.json'),JSON.stringify(software),{flag:'wx',mode:0o600});}
  const bytes = world.read();
  validateWorld(bytes);
  await fs.writeFile(path.join(content, 'world.zip'), bytes, {
    flag: 'wx',
    mode: 0o600,
  });
  for (const entry of entries.filter((entry) =>
    entry.name.startsWith('mods/'),
  )) {
    assert(safeSnapshotPath(entry.name), 'Unsafe mod path.');
    const destination = path.join(content, entry.name);
    await fs.mkdir(path.dirname(destination), {recursive: true});
    await fs.writeFile(destination, entry.read(), {flag: 'wx', mode: 0o600});
  }
  return manifest.software?{software:softwareIdentity(runtimeReceipt(manifest.software))}:{};
}
export async function restoreSnapshot({root, data, manifest}) {
  assert(
    manifest.files.every(
      (file) => file.name === 'world.zip' || file.name === 'software.json' || file.name.startsWith('mods/'),
    ),
    'Unexpected Factorio snapshot file.',
  );
  const softwareFile=path.join(root,'software.json');
  if(manifest.files.some(file=>file.name==='software.json')){const software=runtimeReceipt(JSON.parse(await fs.readFile(softwareFile,'utf8')));await fs.mkdir(path.join(data,'runtime'),{recursive:true});await fs.writeFile(path.join(data,'runtime/bootstrap.json'),JSON.stringify(software),{flag:'wx'});}
  const bytes = await fs.readFile(path.join(root, 'world.zip'));
  validateWorld(bytes);
  await fs.writeFile(path.join(data, 'saves/world.zip'), bytes, {flag: 'wx'});
  if (await fs.stat(path.join(root, 'mods')).catch(() => null))
    await fs.cp(path.join(root, 'mods'), path.join(data, 'mods'), {
      recursive: true,
    });
}
