import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {assert} from '../../common.js';
import {selectedStorage, closeStorage} from './selection.js';
import {withStorageLock} from './coordination.js';
import {
  regularFile,
  parseStorageJSON,
  publishJSON,
  syncDirectory,
} from './files.js';
import {storageGroupManifest, uuidKey} from './groups.js';
import {
  profileDocuments,
  planStorageMigration,
  applyStorageMigration,
} from './migrations.js';

const manifestName = 'management-export.json';
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
function descriptor(profile, groups, namespace, key) {
  const shared = profileDocuments(profile).find(
    (item) => item.namespace === namespace && item.key === key,
  );
  if (shared) return shared;
  const group = groups.find(
    (item) => item.profile === profile && item.namespace === namespace,
  );
  assert(
    group && uuidKey(key),
    'An unknown repository cannot be omitted from recovery. Preserve the database for review.',
    503,
  );
  return {
    file: group.directory + '/' + key + '.json',
    namespace,
    key,
    schemaVersion: group.schemaVersion,
    decode: group.decode,
  };
}
async function checkedFile(root, relative) {
  let current = root;
  for (const part of relative.split('/').slice(0, -1)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    assert(
      stat.isDirectory() && !stat.isSymbolicLink(),
      'Recovery documents cannot use linked directories.',
      503,
    );
  }
  return regularFile(path.join(root, relative));
}
async function privateDirectory(destination, source) {
  const parent = await fs.realpath(path.dirname(path.resolve(destination))),
    target = path.join(parent, path.basename(destination));
  assert(
    target !== source &&
      !target.startsWith(source + path.sep) &&
      !source.startsWith(target + path.sep),
    'Choose a new recovery directory outside the source storage.',
  );
  await fs.mkdir(target, {mode: 0o700});
  return target;
}
async function writeDocument(root, file, bytes) {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), {recursive: true, mode: 0o700});
  const handle = await fs.open(target, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(target));
}
export async function exportManagementStorage(
  root,
  destination,
  {profile, groups = []} = {},
) {
  const canonical = await fs.realpath(root),
    expected = storageGroupManifest(groups).filter(
      (group) => group.profile === profile,
    );
  const exported = await withStorageLock(canonical, 'export', async () => {
    const store = await selectedStorage(canonical);
    assert(
      store,
      'This export requires selected transactional storage. Preserve legacy JSON with the existing offline backup procedure.',
      409,
    );
    assert(
      store.metadata.profile === profile,
      'Choose the selected storage profile.',
    );
    const snapshot = store.exportSnapshot();
    assert(
      JSON.stringify(snapshot.extensions) === JSON.stringify(expected),
      'Recovery requires the original module storage contracts.',
      409,
    );
    const documents = [],
      payloads = [];
    for (const record of snapshot.records) {
      const definition = descriptor(
        profile,
        groups,
        record.namespace,
        record.key,
      );
      assert(
        record.schemaVersion <= definition.schemaVersion,
        'A repository needs a newer recovery tool.',
        503,
      );
      if (record.deleted) continue;
      const bytes = Buffer.from(
        JSON.stringify(definition.decode(record.value), null, 2),
      );
      documents.push({
        file: definition.file,
        namespace: record.namespace,
        key: record.key,
        schemaVersion: record.schemaVersion,
        revision: record.revision,
        sha256: hash(bytes),
      });
      payloads.push({file: definition.file, bytes});
    }
    return {
      manifest: {
        version: 1,
        complete: true,
        profile,
        identity: snapshot.identity,
        planHash: snapshot.planHash,
        extensions: expected,
        documents,
        createdAt: new Date().toISOString(),
      },
      payloads,
    };
  });
  const target = await privateDirectory(destination, canonical);
  for (const payload of exported.payloads)
    await writeDocument(target, payload.file, payload.bytes);
  // A missing manifest makes a partial export unusable. Never overwrite an
  // earlier reviewed artifact, and never publish raw credentials to stdout.
  await publishJSON(path.join(target, manifestName), exported.manifest);
  return {directory: target, manifest: exported.manifest};
}
export async function recoverManagementStorage(
  source,
  destination,
  {confirm = false, offline = false, groups = []} = {},
) {
  assert(
    confirm === true && offline === true,
    'Confirm management writers are stopped before recovering documents into new storage.',
  );
  const canonical = await fs.realpath(source),
    manifest = parseStorageJSON(
      await regularFile(path.join(canonical, manifestName), {
        max: 4 * 1024 * 1024,
      }),
    );
  assert(
    manifest.version === 1 &&
      manifest.complete === true &&
      Array.isArray(manifest.documents) &&
      manifest.documents.length <= 10000,
    'Recovery export is incomplete or unsupported.',
    503,
  );
  profileDocuments(manifest.profile);
  const expected = storageGroupManifest(groups).filter(
    (group) => group.profile === manifest.profile,
  );
  assert(
    JSON.stringify(expected) === JSON.stringify(manifest.extensions),
    'Recovery requires the original module storage contracts.',
    409,
  );
  const payloads = [],
    files = new Set();
  for (const entry of manifest.documents) {
    const definition = descriptor(
      manifest.profile,
      groups,
      entry.namespace,
      entry.key,
    );
    assert(
      entry.file === definition.file &&
        !files.has(entry.file) &&
        Number.isInteger(entry.schemaVersion) &&
        entry.schemaVersion > 0 &&
        entry.schemaVersion <= definition.schemaVersion,
      'Recovery contains an unknown, duplicate or unsupported document.',
      503,
    );
    files.add(entry.file);
    const bytes = await checkedFile(canonical, entry.file);
    assert(
      hash(bytes) === entry.sha256,
      'Recovery document hash changed. Preserve the export for review.',
      503,
    );
    definition.decode(parseStorageJSON(bytes));
    payloads.push({file: entry.file, bytes});
  }
  const target = await privateDirectory(destination, canonical);
  for (const payload of payloads)
    await writeDocument(target, payload.file, payload.bytes);
  try {
    const marker = await applyStorageMigration(
      await planStorageMigration(target, manifest.profile, {groups}),
      {confirm: true, offline: true, groups},
    );
    await publishJSON(path.join(target, 'recovered-management.json'), {
      version: 1,
      sourceIdentity: manifest.identity,
      sourcePlanHash: manifest.planHash,
      identity: marker.identity,
      profile: marker.profile,
      recoveredAt: new Date().toISOString(),
    });
    return {
      directory: target,
      profile: marker.profile,
      identity: marker.identity,
      documents: payloads.length,
    };
  } finally {
    await closeStorage(target);
  }
}
