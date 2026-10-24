import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {constants} from 'node:fs';
import {assert, HttpError} from '../../common.js';

export const markerName = 'panel-storage.json';
export const databaseName = 'panel-state.sqlite';
export function parseStorageJSON(bytes) {
  try {
    return JSON.parse(bytes);
  } catch {
    throw new HttpError(
      503,
      'Panel storage contains invalid JSON. Preserve it for review.',
    );
  }
}
export async function regularFile(
  file,
  {optional = false, max = 32 * 1024 * 1024} = {},
) {
  const stat = await fs.lstat(file).catch((error) => {
    if (optional && error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat) return null;
  assert(
    stat.isFile() && !stat.isSymbolicLink() && stat.size <= max,
    'Panel storage must use bounded regular files.',
    503,
  );
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    assert(
      opened.isFile() &&
        opened.dev === stat.dev &&
        opened.ino === stat.ino &&
        opened.size <= max,
      'Panel storage changed while opening it. Preserve it for review.',
      503,
    );
    const bytes = Buffer.alloc(Math.min(opened.size + 1, max + 1));
    let length = 0;
    while (length < bytes.length) {
      const {bytesRead} = await handle.read(
        bytes,
        length,
        bytes.length - length,
        null,
      );
      if (!bytesRead) break;
      length += bytesRead;
    }
    assert(
      length === opened.size,
      'Panel storage changed while reading it. Try again.',
      409,
    );
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}
export async function syncDirectory(directory) {
  const handle = await fs.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function publishJSON(file, value) {
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  let handle;
  try {
    handle = await fs.open(temp, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(value, null, 2));
    await handle.sync();
    await handle.close();
    handle = null;
    // Exclusive publication: an existing marker is never replaced by migration.
    await fs.link(temp, file);
    await fs.unlink(temp);
    await syncDirectory(path.dirname(file));
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.unlink(temp).catch(() => {});
    throw error;
  }
}
