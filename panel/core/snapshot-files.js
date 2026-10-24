import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createReadStream} from 'node:fs';
import {assert} from '../common.js';

export async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export const safeSnapshotPath = (name) =>
  typeof name === 'string' &&
  name.length > 0 &&
  !name.includes('\\') &&
  !name.includes(':') &&
  !name.startsWith('/') &&
  !name.split('/').some((part) => ['', '.', '..'].includes(part));
export async function snapshotInventory(root, relative = '') {
  assert(
    (await fs.lstat(root)).isDirectory() &&
      (await fs.realpath(root)) === path.resolve(root),
    'Snapshot root cannot be a link.',
  );
  const files = [];
  for (const item of await fs.readdir(path.join(root, relative), {
    withFileTypes: true,
  })) {
    const name = relative ? relative + '/' + item.name : item.name;
    assert(safeSnapshotPath(name), 'Unsafe snapshot path.');
    const stat = await fs.lstat(path.join(root, name));
    assert(!stat.isSymbolicLink(), 'Snapshot links are not supported.');
    if (stat.isDirectory())
      files.push(...(await snapshotInventory(root, name)));
    else {
      assert(stat.isFile(), 'Unsupported snapshot file.');
      files.push({
        name,
        size: stat.size,
        sha256: await hashFile(path.join(root, name)),
      });
    }
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}
