// Disposable Linux runtime check. No daemon, installation mounts or network.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Accounts} from '../core/accounts.js';
import {hashPassword, checkPassword} from '../auth.js';
import {registeredApplications} from '../applications/index.js';
import {
  planStorageMigration,
  applyStorageMigration,
} from '../core/storage/migrations.js';
import {
  exportManagementStorage,
  recoverManagementStorage,
} from '../core/storage/recovery.js';
import {closeStorage, selectedStorage} from '../core/storage/selection.js';
import {
  managementMaintenance,
  writeManagementActivation,
} from '../core/management-maintenance.js';

assert.equal(process.platform, 'linux');
const base = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'lobby-runtime-storage-')),
  ),
  root = path.join(base, 'source'),
  groups = registeredApplications().flatMap((module) => module.storage?.groups || []);
await fs.mkdir(root, {mode: 0o700});
try {
  const original = JSON.stringify({
    Owner: {...hashPassword('disposable owner password'), role: 'admin'},
    Assigned: {
      ...hashPassword('disposable member password'),
      role: 'member',
      grants: {standalone: ['server.view']},
      accessRevision: 7,
    },
  });
  await fs.writeFile(path.join(root, 'users.json'), original, {mode: 0o600});
  const plan = await planStorageMigration(root, 'accounts', {groups});
  assert.doesNotMatch(
    JSON.stringify(plan),
    /disposable owner password|disposable member password/,
  );
  await applyStorageMigration(plan, {confirm: true, offline: true, groups});
  const accounts = new Accounts(root),
    other = new Accounts(root);
  assert.equal((await selectedStorage(root)).metadata.profile, 'accounts');
  assert.ok(
    checkPassword('disposable owner password', (await accounts.users()).Owner),
  );
  await assert.rejects(
    () =>
      accounts.update({
        username: 'Owner',
        operation: 'role',
        role: 'viewer',
        confirm: true,
      }),
    /at least one administrator/,
  );
  await accounts.update({
    username: 'Assigned',
    operation: 'grants',
    revision: 7,
    grants: {standalone: ['server.view', 'logs.read']},
    confirm: true,
  });
  await assert.rejects(
    () =>
      other.update({
        username: 'Assigned',
        operation: 'grants',
        revision: 7,
        grants: {},
        confirm: true,
      }),
    /another session/,
  );
  const activation = 'a'.repeat(32);
  await writeManagementActivation(root, activation);
  assert.equal(
    (await managementMaintenance(root, {PANEL_MAINTENANCE_ID: activation}))
      .held,
    false,
  );
  const exported = await exportManagementStorage(
    root,
    path.join(base, 'export'),
    {profile: 'accounts', groups},
  );
  const recovered = await recoverManagementStorage(
    exported.directory,
    path.join(base, 'recovered'),
    {confirm: true, offline: true, groups},
  );
  assert.notEqual(recovered.identity, exported.manifest.identity);
  const restored = await new Accounts(recovered.directory).users();
  assert.ok(checkPassword('disposable owner password', restored.Owner));
  assert.deepEqual(restored.Assigned.grants, {
    standalone: ['logs.read', 'server.view'],
  });
  assert.equal(restored.Assigned.accessRevision, 8);
  assert.equal(
    await fs.readFile(path.join(root, 'users.json'), 'utf8'),
    original,
  );
  assert.equal(
    (
      await managementMaintenance(recovered.directory, {
        PANEL_MAINTENANCE_ID: activation,
      })
    ).held,
    true,
    'Document recovery must not silently activate a new management installation.',
  );
  console.log(
    'Linux runtime SQLite migration, access conflicts, private export/recovery and maintenance activation checks passed.',
  );
} finally {
  for (const directory of await fs.readdir(base, {withFileTypes: true}))
    if (directory.isDirectory())
      await closeStorage(path.join(base, directory.name));
  await fs.rm(base, {recursive: true, force: true});
}
