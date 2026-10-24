import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {assert, HttpError, sleep} from '../../common.js';
import {regularFile} from './files.js';

const lockName = '.panel-storage-lock';
const heldLocks = new AsyncLocalStorage();
const identity = (stat) => ({dev: stat.dev, ino: stat.ino});
const same = (stat, value) => stat.dev === value.dev && stat.ino === value.ino;
const token = () => crypto.randomUUID();
const fingerprint = (bytes) =>
  bytes ? crypto.createHash('sha256').update(bytes).digest('hex') : null;
export async function inspectStorageLock(root) {
  const directory = path.join(await fs.realpath(root), lockName),
    stat = await fs.lstat(directory).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
  if (!stat) return null;
  assert(
    stat.isDirectory() && !stat.isSymbolicLink(),
    'Storage coordination lock is unsafe. Preserve it for review.',
    503,
  );
  const bytes = await regularFile(path.join(directory, 'owner.json'), {
    optional: true,
    max: 4096,
  });
  let value;
  try {
    value = bytes ? JSON.parse(bytes) : null;
  } catch {}
  const valid =
    value?.version === 1 &&
    typeof value.token === 'string' &&
    /^[a-f0-9-]{36}$/.test(value.token) &&
    ['write', 'migration', 'export'].includes(value.purpose);
  const owner = valid
    ? {
        version: 1,
        token: value.token,
        purpose: value.purpose,
        ...(Number.isSafeInteger(value.pid) ? {pid: value.pid} : {}),
        ...(typeof value.createdAt === 'string' && value.createdAt.length <= 40
          ? {createdAt: value.createdAt}
          : {}),
      }
    : null;
  // A crash can truncate owner.json before any work starts. Review binds the
  // opaque bytes as well as directory identity; malformed values are not shown.
  return {
    directory,
    identity: identity(stat),
    owner,
    ownerHash: fingerprint(bytes),
    incomplete: !!bytes && !valid,
  };
}
async function removeLock(lock) {
  const stat = await fs.lstat(lock.directory);
  assert(
    stat.isDirectory() && !stat.isSymbolicLink() && same(stat, lock.identity),
    'Storage coordination identity changed.',
    409,
  );
  const entries = await fs.readdir(lock.directory);
  assert(
    entries.every((name) => name === 'owner.json'),
    'Storage coordination lock contains unknown files. Preserve it for review.',
    503,
  );
  const bytes = await regularFile(path.join(lock.directory, 'owner.json'), {
    optional: true,
    max: 4096,
  });
  assert(
    fingerprint(bytes) === lock.ownerHash,
    'Storage coordination owner changed.',
    409,
  );
  if (bytes) await fs.unlink(path.join(lock.directory, 'owner.json'));
  await fs.rmdir(lock.directory);
}
export async function withStorageLock(
  root,
  purpose,
  work,
  {timeout = 2500} = {},
) {
  assert(
    ['write', 'migration', 'export'].includes(purpose) &&
      Number.isInteger(timeout) &&
      timeout >= 0 &&
      timeout <= 30000,
    'Invalid storage coordination request.',
  );
  if (purpose === 'write') await fs.mkdir(root, {recursive: true});
  const canonical = await fs.realpath(root),
    directory = path.join(canonical, lockName),
    deadline = Date.now() + timeout;
  if (heldLocks.getStore()?.get(canonical)?.active) return work();
  for (;;) {
    try {
      await fs.mkdir(directory, {mode: 0o700});
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline)
        throw new HttpError(
          503,
          'Panel storage is busy or has an interrupted writer. Review its coordination lock before retrying.',
        );
      await sleep(Math.min(25, Math.max(1, deadline - Date.now())));
    }
  }
  const stat = await fs.lstat(directory),
    owner = {
      version: 1,
      token: token(),
      purpose,
      pid: process.pid,
      createdAt: new Date().toISOString(),
    },
    ownerBytes = Buffer.from(JSON.stringify(owner)),
    lock = {
      directory,
      identity: identity(stat),
      owner,
      ownerHash: fingerprint(ownerBytes),
    };
  // Once the directory is acquired, an interrupted initialization is retained
  // for explicit offline review. A PID is diagnostic only across containers.
  const handle = await fs.open(path.join(directory, 'owner.json'), 'wx', 0o600);
  try {
    await handle.writeFile(ownerBytes);
  } finally {
    await handle.close();
  }
  // This is a live-writer lease, not a durability journal. Kernel-visible
  // creation/removal coordinates cooperating processes. A host power failure
  // kills all of those writers; a retained lease still needs offline review.
  // Data commits and activation/export markers carry their own disk barriers.
  // Cleanup cannot turn a confirmed commit into a reported failed write: callers
  // would otherwise restore stale in-memory state over a durable new revision.
  // A retained lock fences later writers until explicit offline recovery.
  const scope = {active: true},
    held = new Map(heldLocks.getStore() || []);
  held.set(canonical, scope);
  try {
    return await heldLocks.run(held, work);
  } finally {
    scope.active = false;
    try {
      await removeLock(lock);
    } catch {
      console.error(
        'Panel storage coordination could not be released. Retain the storage and review its lock offline.',
      );
    }
  }
}
export async function recoverStorageLock(
  root,
  review,
  {confirm = false, offline = false} = {},
) {
  assert(
    confirm === true && offline === true,
    'Confirm all management writers are stopped before clearing an interrupted storage lock.',
  );
  const current = await inspectStorageLock(root);
  assert(
    current &&
      review &&
      review.identity &&
      same(current.identity, review.identity) &&
      current.ownerHash === review.ownerHash &&
      current.owner?.token === review.owner?.token,
    'Storage coordination lock changed after review.',
    409,
  );
  await removeLock(current);
  return {cleared: true};
}
