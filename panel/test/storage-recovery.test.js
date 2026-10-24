import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Accounts} from '../applications/factorio/accounts.js';
import {storage} from '../applications/factorio/storage.js';
import {
  planStorageMigration,
  applyStorageMigration,
} from '../core/storage/migrations.js';
import {
  exportManagementStorage,
  recoverManagementStorage,
} from '../core/storage/recovery.js';
import {selectedStorage, closeStorage} from '../core/storage/selection.js';
import {storageMain} from '../storage.js';
import {hashPassword, checkPassword} from '../auth.js';
import {writeJSON} from '../common.js';
const groups = storage.groups;
async function fixture(t) {
  const base = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'lobby-storage-recovery-')),
    ),
    root = path.join(base, 'source');
  await fs.mkdir(root);
  t.after(async () => {
    for (const directory of await fs.readdir(base, {withFileTypes: true}))
      if (directory.isDirectory())
        await closeStorage(path.join(base, directory.name));
    await fs.rm(base, {recursive: true, force: true});
  });
  return {base, root};
}
const migrate = async (root, profile) =>
  applyStorageMigration(await planStorageMigration(root, profile, {groups}), {
    confirm: true,
    offline: true,
    groups,
  });

test('a coherent current export recovers credentials, assignments and module records into new storage while original installation and world bytes stay untouched', async (t) => {
  const {base, root} = await fixture(t),
    scope = '/servers/' + 'a'.repeat(32);
  await writeJSON(path.join(root, 'users.json'), {
    Owner: {...hashPassword('original fixture password'), role: 'admin'},
    Assigned: {
      ...hashPassword('member fixture password'),
      role: 'member',
      grants: {[scope]: ['server.view', 'server.operate']},
      accessRevision: 7,
    },
  });
  const legacy = await fs.readFile(path.join(root, 'users.json'), 'utf8');
  await fs.writeFile(
    path.join(root, 'existing-world.zip'),
    'unchanged world bytes',
  );
  await migrate(root, 'accounts');
  const accounts = new Accounts(root),
    defaults = JSON.parse(
      await fs.readFile(new URL('../world-defaults.json', import.meta.url)),
    );
  await accounts.worldSetups('Owner', {
    operation: 'draft',
    revision: 0,
    draft: {
      name: 'Database-only draft',
      seed: '123',
      image: 'fixture:2.0.77',
      base: 'defaults',
      step: 2,
      configuration: JSON.stringify(defaults),
      advanced: '{ unfinished',
      advancedDirty: true,
      inputs: {},
      preview: true,
      activate: false,
    },
  });
  await accounts.changePassword(
    'Owner',
    'original fixture password',
    'replacement fixture password',
  );
  const exported = await exportManagementStorage(
    root,
    path.join(base, 'export'),
    {profile: 'accounts', groups},
  );
  assert.equal((await fs.stat(exported.directory)).mode & 0o077, 0);
  for (const document of exported.manifest.documents)
    assert.equal(
      (await fs.stat(path.join(exported.directory, document.file))).mode &
        0o077,
      0,
    );
  const recovered = await recoverManagementStorage(
    exported.directory,
    path.join(base, 'recovered'),
    {confirm: true, offline: true, groups},
  );
  assert.notEqual(recovered.identity, exported.manifest.identity);
  const restored = new Accounts(recovered.directory),
    users = await restored.users();
  assert.ok(checkPassword('replacement fixture password', users.Owner));
  assert.ok(!checkPassword('original fixture password', users.Owner));
  assert.deepEqual(users.Assigned.grants, {
    [scope]: ['server.view', 'server.operate'],
  });
  assert.equal(users.Assigned.accessRevision, 7);
  assert.equal(
    (await restored.worldSetups('Owner')).draft.name,
    'Database-only draft',
  );
  assert.equal(
    await fs.readFile(path.join(root, 'users.json'), 'utf8'),
    legacy,
  );
  assert.equal(
    await fs.readFile(path.join(root, 'existing-world.zip'), 'utf8'),
    'unchanged world bytes',
  );
  await assert.rejects(
    fs.access(path.join(exported.directory, 'existing-world.zip')),
    {code: 'ENOENT'},
  );
  await assert.rejects(
    exportManagementStorage(root, exported.directory, {
      profile: 'accounts',
      groups,
    }),
    {code: 'EEXIST'},
  );
  await assert.rejects(
    recoverManagementStorage(exported.directory, root, {
      confirm: true,
      offline: true,
      groups,
    }),
    {code: 'EEXIST'},
  );
});

test('host registry identities, runtime images, volumes and interrupted jobs survive export/recovery without operational actions', async (t) => {
  const {base, root} = await fixture(t),
    registry = {
      version: 1,
      servers: [
        {
          id: 'a'.repeat(32),
          container: 'existing-container-name',
          image: 'fixture@sha256:' + 'b'.repeat(64),
          volume: 'existing-fixture-volume',
          state: 'installed',
          controllerToken: 'fixture-only-token',
        },
      ],
      snapshots: [],
      jobs: [
        {
          id: 'operation',
          state: 'interrupted',
          action: 'create',
          recovery: {required: true},
        },
      ],
    };
  await writeJSON(path.join(root, 'registry.json'), registry);
  await migrate(root, 'host');
  const exported = await exportManagementStorage(
      root,
      path.join(base, 'export'),
      {profile: 'host', groups},
    ),
    restored = await recoverManagementStorage(
      exported.directory,
      path.join(base, 'restored'),
      {confirm: true, offline: true, groups},
    );
  assert.deepEqual(
    (await selectedStorage(restored.directory)).read('registry', 'host').value,
    registry,
  );
  assert.equal(
    await fs.readFile(path.join(root, 'registry.json'), 'utf8'),
    JSON.stringify(registry, null, 2),
  );
});

test('incomplete, altered, linked and unknown recovery data fail before a destination is created', async (t) => {
  const {base, root} = await fixture(t);
  await writeJSON(path.join(root, 'users.json'), {});
  await migrate(root, 'accounts');
  const exported = await exportManagementStorage(
      root,
      path.join(base, 'export'),
      {profile: 'accounts', groups},
    ),
    document = exported.manifest.documents[0],
    target = path.join(base, 'refused');
  const file = path.join(exported.directory, document.file),
    original = await fs.readFile(file);
  await fs.writeFile(file, '{}');
  await assert.rejects(
    recoverManagementStorage(exported.directory, target, {
      confirm: true,
      offline: true,
      groups,
    }),
    /hash changed/,
  );
  await assert.rejects(fs.access(target), {code: 'ENOENT'});
  await fs.writeFile(file, original);
  await assert.rejects(
    recoverManagementStorage(exported.directory, target, {
      confirm: true,
      groups,
    }),
    /writers are stopped/,
  );
  const manifest = path.join(exported.directory, 'management-export.json'),
    bytes = await fs.readFile(manifest);
  await fs.unlink(manifest);
  await assert.rejects(
    recoverManagementStorage(exported.directory, target, {
      confirm: true,
      offline: true,
      groups,
    }),
    {code: 'ENOENT'},
  );
  await fs.writeFile(manifest, bytes);
  const outside = path.join(base, 'outside.json');
  await fs.writeFile(outside, original);
  await fs.unlink(file);
  await fs.symlink(outside, file);
  await assert.rejects(
    recoverManagementStorage(exported.directory, target, {
      confirm: true,
      offline: true,
      groups,
    }),
    /regular files/,
  );
  await assert.rejects(fs.access(target), {code: 'ENOENT'});
  const store = await selectedStorage(root);
  store.commit([
    {
      namespace: 'unknown-module',
      key: 'unknown',
      schemaVersion: 1,
      expectedRevision: 0,
      value: {kept: true},
    },
  ]);
  await assert.rejects(
    exportManagementStorage(root, path.join(base, 'not-exported'), {
      profile: 'accounts',
      groups,
    }),
    /unknown repository/,
  );
  await assert.rejects(fs.access(path.join(base, 'not-exported')), {
    code: 'ENOENT',
  });
});

test('operator commands use an explicit reviewed root/profile, refuse missing confirmation and keep output free of credential values', async (t) => {
  const {base, root} = await fixture(t);
  await writeJSON(path.join(root, 'users.json'), {
    Owner: {role: 'admin', hash: 'fixture-private-value'},
  });
  const output = [],
    invoke = (args) =>
      storageMain(args, {
        modules: [{storage}],
        write: (value) => output.push(value),
      }),
    plan = path.join(base, 'reviewed-plan.json');
  await invoke([
    'plan',
    '--root',
    root,
    '--profile',
    'accounts',
    '--out',
    plan,
  ]);
  assert.ok(!JSON.stringify(output).includes('fixture-private-value'));
  await assert.rejects(
    invoke([
      'migrate',
      '--root',
      root,
      '--profile',
      'accounts',
      '--plan',
      plan,
    ]),
    /writers are stopped/,
  );
  await invoke([
    'migrate',
    '--root',
    root,
    '--profile',
    'accounts',
    '--plan',
    plan,
    '--offline',
    '--confirm',
  ]);
  await invoke(['status', '--root', root, '--profile', 'accounts']);
  assert.equal(output.at(-1).backend, 'sqlite');
  assert.ok(!JSON.stringify(output).includes('fixture-private-value'));
  await assert.rejects(
    invoke(['status', '--root', root, '--profile', 'accounts', '--confirm']),
    /does not accept/,
  );
  await assert.rejects(
    invoke(['status', '--profile', 'accounts']),
    /explicit management/,
  );
});

test('the actual CLI loads registered module contracts and reviews legacy state without starting runtime code', async (t) => {
  const {root} = await fixture(t);
  await writeJSON(path.join(root, 'users.json'), {});
  const before = await fs.readdir(root);
  const {stdout} = await promisify(execFile)(
    process.execPath,
    [
      new URL('../storage.js', import.meta.url).pathname,
      'status',
      '--root',
      root,
      '--profile',
      'accounts',
    ],
    {
      env: {
        ...process.env,
        DOCKER_SOCKET: '/nonexistent/lobby-storage-test.sock',
      },
    },
  );
  const status = JSON.parse(stdout);
  assert.equal(status.backend, 'json');
  assert.equal(status.lock, null);
  assert.deepEqual(await fs.readdir(root), before);
});

test('malformed private JSON is reported without including its contents in CLI errors', async (t) => {
  const {root} = await fixture(t),
    secret = 'fixture-private-parse-value';
  await fs.writeFile(
    path.join(root, 'users.json'),
    '{"Owner":{"password":"' + secret,
  );
  await assert.rejects(
    promisify(execFile)(
      process.execPath,
      [
        new URL('../storage.js', import.meta.url).pathname,
        'status',
        '--root',
        root,
        '--profile',
        'accounts',
      ],
      {
        env: {
          ...process.env,
          DOCKER_SOCKET: '/nonexistent/lobby-storage-test.sock',
        },
      },
    ),
    (error) =>
      error.code === 1 &&
      error.stderr.includes('invalid JSON') &&
      !error.stderr.includes(secret) &&
      !error.message.includes(secret),
  );
});
