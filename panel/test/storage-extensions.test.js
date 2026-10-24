import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Accounts} from '../applications/factorio/accounts.js';
import {storage} from '../applications/factorio/storage.js';
import {
  planStorageMigration,
  applyStorageMigration,
} from '../core/storage/migrations.js';
import {selectedStorage, closeStorage} from '../core/storage/selection.js';
import {validateStorageGroups} from '../core/storage/groups.js';
const defaults = JSON.parse(
  await fs.readFile(new URL('../world-defaults.json', import.meta.url)),
);
const draft = (name) => ({
  name,
  seed: '12345',
  image: 'fixture:2.0.77',
  base: 'defaults',
  step: 2,
  configuration: JSON.stringify(defaults),
  advanced: '{ unfinished',
  advancedDirty: true,
  inputs: {},
  preview: true,
  activate: false,
});
async function fixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'lobby-storage-extension-')),
  );
  t.after(async () => {
    await closeStorage(root);
    await fs.rm(root, {recursive: true, force: true});
  });
  const accounts = new Accounts(root);
  for (const username of ['Owner', 'Other']) {
    const invitation = await accounts.invite('admin', 'Setup');
    await accounts.register({
      username,
      password: 'disposable extension password',
      token: invitation.token,
    });
  }
  return {root, accounts};
}
const migrate = async (root) =>
  applyStorageMigration(
    await planStorageMigration(root, 'accounts', {groups: storage.groups}),
    {confirm: true, offline: true, groups: storage.groups},
  );

test('module-owned draft migration retains original bytes, handles competing saves and deletes related records with the account atomically', async (t) => {
  const {root, accounts} = await fixture(t);
  await accounts.worldSetups('Owner', {
    operation: 'draft',
    revision: 0,
    draft: draft('Original fixture'),
  });
  const users = await fs.readFile(path.join(root, 'users.json'), 'utf8'),
    id = (await accounts.users()).Owner.worldSetupId,
    source = path.join(root, 'world-setups', id + '.json'),
    bytes = await fs.readFile(source, 'utf8');
  const plan = await planStorageMigration(root, 'accounts', {
    groups: storage.groups,
  });
  assert.ok(
    plan.files.some((file) => file.namespace === 'factorio-world-setups'),
  );
  assert.ok(!JSON.stringify(plan).includes('Original fixture'));
  await applyStorageMigration(plan, {
    confirm: true,
    offline: true,
    groups: storage.groups,
  });
  const one = new Accounts(root),
    two = new Accounts(root);
  assert.equal((await one.worldSetups('Owner')).draft.name, 'Original fixture');
  const saved = await Promise.allSettled([
    one.worldSetups('Owner', {
      operation: 'draft',
      revision: 1,
      draft: draft('One'),
    }),
    two.worldSetups('Owner', {
      operation: 'draft',
      revision: 1,
      draft: draft('Two'),
    }),
  ]);
  assert.equal(saved.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(
    saved.find((item) => item.status === 'rejected').reason.status,
    409,
  );
  const store = await selectedStorage(root),
    sql = new DatabaseSync(store.file);
  sql.exec(
    "CREATE TRIGGER prevent_related_delete BEFORE UPDATE ON documents WHEN new.namespace='factorio-world-setups' AND new.deleted=1 BEGIN SELECT RAISE(ABORT,'Injected related record failure'); END",
  );
  await assert.rejects(
    one.update({username: 'Owner', operation: 'delete', confirm: true}),
    /Injected related record failure/,
  );
  assert.ok((await one.users()).Owner);
  assert.equal((await one.worldSetups('Owner')).revision, 2);
  sql.exec('DROP TRIGGER prevent_related_delete');
  sql.close();
  await one.update({username: 'Owner', operation: 'delete', confirm: true});
  assert.equal((await one.users()).Owner, undefined);
  assert.equal(store.read('factorio-world-setups', id).exists, false);
  assert.equal(await fs.readFile(path.join(root, 'users.json'), 'utf8'), users);
  assert.equal(await fs.readFile(source, 'utf8'), bytes);
  const invitation = await one.invite('admin', 'Other');
  await one.register({
    username: 'Owner',
    password: 'a recreated fixture password',
    token: invitation.token,
  });
  assert.equal((await one.worldSetups('Owner')).draft, null);
});

test('failed first draft creation cannot leave an account reference without its document', async (t) => {
  const {root} = await fixture(t);
  await migrate(root);
  const accounts = new Accounts(root),
    store = await selectedStorage(root),
    sql = new DatabaseSync(store.file);
  sql.exec(
    "CREATE TRIGGER prevent_draft_insert BEFORE INSERT ON documents WHEN new.namespace='factorio-world-setups' BEGIN SELECT RAISE(ABORT,'Injected draft insert failure'); END",
  );
  await assert.rejects(
    accounts.worldSetups('Owner', {
      operation: 'draft',
      revision: 0,
      draft: draft('Never published'),
    }),
    /Injected draft insert failure/,
  );
  assert.equal((await accounts.users()).Owner.worldSetupId, undefined);
  assert.equal(
    store
      .exportSnapshot()
      .records.filter((record) => record.namespace === 'factorio-world-setups')
      .length,
    0,
  );
  sql.close();
});

test('storage extension contracts are checked and a migration cannot silently omit or change its reviewed groups', async (t) => {
  const {root} = await fixture(t);
  const plan = await planStorageMigration(root, 'accounts', {
    groups: storage.groups,
  });
  await assert.rejects(
    applyStorageMigration(plan, {confirm: true, offline: true}),
    /contracts changed/,
  );
  assert.throws(
    () => validateStorageGroups([storage.groups[0], storage.groups[0]]),
    /Duplicate/,
  );
  assert.throws(
    () =>
      validateStorageGroups([{...storage.groups[0], directory: '../outside'}]),
    /Invalid/,
  );
  assert.throws(
    () =>
      validateStorageGroups([{...storage.groups[0], namespace: 'accounts'}]),
    /cannot replace/,
  );
  const directory = path.join(root, 'world-setups');
  await fs.mkdir(directory);
  const outside = path.join(root, 'outside.json');
  await fs.writeFile(outside, 'unrelated');
  await fs.symlink(
    outside,
    path.join(
      directory,
      'a'.repeat(8) + '-aaaa-aaaa-aaaa-' + 'a'.repeat(12) + '.json',
    ),
  );
  await assert.rejects(
    planStorageMigration(root, 'accounts', {groups: storage.groups}),
    /symbolic links/,
  );
  assert.equal(await fs.readFile(outside, 'utf8'), 'unrelated');
});

test('an unregistered module cannot write undeclared records into a selected shared store', async (t) => {
  const {root} = await fixture(t);
  await applyStorageMigration(await planStorageMigration(root, 'accounts'), {
    confirm: true,
    offline: true,
  });
  const accounts = new Accounts(root);
  await assert.rejects(
    accounts.worldSetups('Owner', {
      operation: 'draft',
      revision: 0,
      draft: draft('Unregistered'),
    }),
    /reviewed storage extension migration/,
  );
  assert.equal((await accounts.users()).Owner.worldSetupId, undefined);
  assert.equal(
    (await selectedStorage(root))
      .exportSnapshot()
      .records.some((record) => record.namespace === 'factorio-world-setups'),
    false,
  );
});
