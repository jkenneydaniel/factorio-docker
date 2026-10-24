import fs from 'node:fs/promises';
import path from 'node:path';
import {assert} from '../../common.js';
import {SqliteDocumentStore} from './sqlite-store.js';
import {
  regularFile,
  parseStorageJSON,
  markerName,
  databaseName,
} from './files.js';

const stores = new Map();
const selectedRoots = new Set();
const selectedPaths = new Map();
export function storageMarker(value) {
  assert(
    value?.version === 1 &&
      value.backend === 'sqlite' &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        value.identity,
      ) &&
      ['accounts', 'controller', 'host'].includes(value.profile) &&
      /^[a-f0-9]{64}$/.test(value.planHash),
    'Invalid panel storage marker. Preserve it for review.',
    503,
  );
  return value;
}
export async function selectedStorage(root) {
  const requested = path.resolve(root);
  const canonical = await fs.realpath(root).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const marker = await regularFile(path.join(root, markerName), {
    optional: true,
    max: 1024 * 1024,
  });
  if (!marker) {
    assert(
      !selectedRoots.has(canonical) && !selectedPaths.has(requested),
      'Selected panel storage marker is missing. Preserve both stores for review.',
      503,
    );
    return null;
  }
  assert(
    canonical,
    'Selected panel storage root is unavailable. Preserve it for review.',
    503,
  );
  const value = storageMarker(parseStorageJSON(marker)),
    file = path.join(canonical, databaseName);
  let store = stores.get(file);
  if (!store || store.closed) {
    store = new SqliteDocumentStore(file, {
      identity: value.identity,
      profile: value.profile,
    });
    stores.set(file, store);
  }
  const stat = await fs.lstat(file);
  assert(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      (stat.mode & 0o077) === 0 &&
      stat.dev === store.fileIdentity.dev &&
      stat.ino === store.fileIdentity.ino,
    'Selected panel database was replaced or is unsafe. Preserve both stores for review.',
    503,
  );
  assert(
    store.metadata.identity === value.identity &&
      store.metadata.profile === value.profile &&
      store.metadata.planHash === value.planHash,
    'Selected storage identity changed.',
    503,
  );
  selectedRoots.add(canonical);
  selectedPaths.set(requested, canonical);
  return store;
}
export async function closeStorage(root) {
  const requested = path.resolve(root),
    canonical = await fs.realpath(root).catch((error) => {
      if (error.code === 'ENOENT')
        return selectedPaths.get(requested) || requested;
      throw error;
    }),
    file = path.join(canonical, databaseName),
    store = stores.get(file);
  store?.close();
  stores.delete(file);
  selectedRoots.delete(canonical);
  for (const [key, value] of selectedPaths)
    if (value === canonical) selectedPaths.delete(key);
}
