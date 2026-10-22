import fs from 'node:fs/promises';
import path from 'node:path';
import {createReadStream} from 'node:fs';
import {createGunzip} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import {assert, inside, writeJSON} from '../../common.js';
import {safeSnapshotPath as safe} from '../../core/snapshot-files.js';
import {verifyArchive} from './archive.js';

// Verify the complete archive before extracting its regular-file-only TAR.
export async function extractRust(file, target) {
  await verifyArchive(file);
  await fs.mkdir(target, {recursive: true});
  const input = createReadStream(file),
    unzip = createGunzip(),
    finished = pipeline(input, unzip);
  void finished.catch(() => {});
  const iterator = unzip[Symbol.asyncIterator]();
  let buffered = Buffer.alloc(0);
  async function take(n) {
    while (buffered.length < n) {
      const next = await iterator.next();
      assert(!next.done, 'Truncated archive.');
      buffered = Buffer.concat([buffered, next.value]);
    }
    const v = buffered.subarray(0, n);
    buffered = buffered.subarray(n);
    return v;
  }
  try {
    while (true) {
      const block = await take(512);
      if (block.every((n) => n === 0)) break;
      const prefix = block.subarray(345, 500).toString().replace(/\0.*$/, ''),
        name =
          (prefix ? prefix + '/' : '') +
          block.subarray(0, 100).toString().replace(/\0.*$/, ''),
        size = parseInt(
          block.subarray(124, 136).toString().replace(/\0.*$/, '').trim(),
          8,
        );
      assert(safe(name) && block[156] === 48, 'Unsafe snapshot archive.');
      const dest = inside(target, name);
      await fs.mkdir(path.dirname(dest), {recursive: true});
      const out = await fs.open(dest, 'wx', 0o600);
      try {
        for (let left = size; left > 0;) {
          const b = await take(Math.min(left, 65536));
          left -= b.length;
          await out.write(b);
        }
      } finally {
        await out.close();
      }
      await take((512 - (size % 512)) % 512);
    }
    for await (const chunk of {[Symbol.asyncIterator]: () => iterator}) {
    }
    await finished;
  } finally {
    input.destroy();
    unzip.destroy();
    await finished.catch(() => {});
  }
}

export async function collectSnapshot({backup, content, temporary, record}) {
  assert(
    !(await verifyArchive(backup)).modded,
    'Modded Rust backups must be recovered as a complete installation; world-only snapshot cloning would omit framework and plugin state.',
    409,
  );
  await extractRust(backup, path.join(temporary, 'extracted'));
  const identity = path.join(temporary, 'extracted/identity');
  await fs.mkdir(path.join(content, 'identity'));
  assert(
    (await fs.readdir(identity)).some(
      (name) =>
        name.startsWith(`proceduralmap.${record.worldSize}.${record.seed}.`) &&
        name.endsWith('.sav'),
    ),
    'Rust save does not match the source server seed and size.',
  );
  for (const entry of await fs.readdir(identity)) {
    if (entry === 'cfg') continue;
    assert(safe(entry), 'Unsafe identity file.');
    await fs.cp(
      path.join(identity, entry),
      path.join(content, 'identity', entry),
      {recursive: true, dereference: false},
    );
  }
  await fs.rm(path.join(temporary, 'extracted'), {recursive: true});
}
export async function restoreSnapshot({root, data, manifest, id}) {
  assert(
    manifest.files.every(
      (file) =>
        file.name.startsWith('identity/') &&
        !file.name.startsWith('identity/cfg/'),
    ),
    'Unexpected Rust snapshot file.',
  );
  await fs.cp(
    path.join(root, 'identity'),
    path.join(data, 'server/lobby-goblin-rust'),
    {recursive: true},
  );
  // Only a new independent copy may authorize Steam installation.
  await writeJSON(path.join(data, '.lobby-goblin-clone.json'), {
    game: 'rust',
    identity: 'lobby-goblin-rust',
    snapshot: id,
  });
}
