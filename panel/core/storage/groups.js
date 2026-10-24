import fs from 'node:fs/promises';
import path from 'node:path';
import {assert} from '../../common.js';

const name = (value) =>
  typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
export const uuidKey = (value) =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export function validateStorageGroups(groups) {
  assert(
    Array.isArray(groups) && groups.length <= 32,
    'Invalid storage extension groups.',
  );
  const ids = new Set(),
    namespaces = new Set(),
    directories = new Set();
  for (const group of groups) {
    assert(
      group &&
        group.version === 1 &&
        name(group.id) &&
        name(group.namespace) &&
        name(group.directory) &&
        group.profile === 'accounts' &&
        group.keyFormat === 'uuid' &&
        Number.isInteger(group.schemaVersion) &&
        group.schemaVersion > 0 &&
        group.schemaVersion <= 1000 &&
        typeof group.decode === 'function',
      'Invalid storage extension group.',
    );
    assert(
      ![
        'accounts',
        'operations',
        'registry',
        'configuration',
        'audit',
      ].includes(group.namespace),
      'Storage extensions cannot replace shared repositories.',
    );
    assert(
      !ids.has(group.id) &&
        !namespaces.has(group.namespace) &&
        !directories.has(group.directory),
      'Duplicate storage extension group.',
    );
    ids.add(group.id);
    namespaces.add(group.namespace);
    directories.add(group.directory);
  }
  return groups;
}
export function storageGroupManifest(groups) {
  return validateStorageGroups(groups)
    .map(
      ({
        id,
        version,
        profile,
        namespace,
        directory,
        keyFormat,
        schemaVersion,
      }) => ({
        id,
        version,
        profile,
        namespace,
        directory,
        keyFormat,
        schemaVersion,
      }),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}
export async function groupDocuments(root, profile, groups) {
  const descriptors = [];
  for (const group of validateStorageGroups(groups).filter(
    (group) => group.profile === profile,
  )) {
    const directory = path.join(root, group.directory),
      stat = await fs.lstat(directory).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    if (!stat) continue;
    assert(
      stat.isDirectory() && !stat.isSymbolicLink(),
      'Module storage must use a real directory.',
      503,
    );
    const entries = await fs.readdir(directory, {withFileTypes: true});
    assert(
      entries.length <= 10000,
      'Module storage inventory is too large for one migration.',
      503,
    );
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      assert(
        !entry.isSymbolicLink(),
        'Module storage cannot include symbolic links.',
        503,
      );
      if (!entry.name.endsWith('.json')) continue;
      const key = entry.name.slice(0, -5);
      assert(
        entry.isFile() && uuidKey(key),
        'Unknown module storage file. Preserve it for review.',
        503,
      );
      descriptors.push({
        file: group.directory + '/' + entry.name,
        namespace: group.namespace,
        key,
        schemaVersion: group.schemaVersion,
        decode: group.decode,
      });
    }
  }
  return descriptors;
}
