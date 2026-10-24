import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {SqliteDocumentStore} from '../core/storage/sqlite-store.js';
import {AccountsRepository} from '../core/storage/document-repository.js';
import {
  planStorageMigration,
  applyStorageMigration,
} from '../core/storage/migrations.js';
import {closeStorage, selectedStorage} from '../core/storage/selection.js';
import {databaseName, markerName} from '../core/storage/files.js';
import {Accounts} from '../core/accounts.js';
import {hashPassword} from '../auth.js';
import {writeJSON} from '../common.js';
import {AuditLog} from '../core/audit.js';
import {FleetManager} from '../fleet/manager.js';
import {RemoteHosts} from '../fleet/hosts.js';
import {HostSetup} from '../fleet/host-setup.js';
import {
  AuditRepository,
  RegistryRepository,
  HostSetupRepository,
  ConfigurationRepository,
} from '../core/storage/state-repositories.js';

async function temporary(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'lobby-storage-')),
  );
  t.after(async () => {
    await closeStorage(root);
    await fs.rm(root, {recursive: true, force: true});
  });
  return root;
}
function database(t, root) {
  const store = new SqliteDocumentStore(path.join(root, databaseName), {
    create: true,
    identity: crypto.randomUUID(),
    profile: 'accounts',
    planHash: 'a'.repeat(64),
  });
  t.after(() => store.close());
  return store;
}
const change = (key, value, expectedRevision = 0) => ({
  namespace: 'test',
  key,
  schemaVersion: 1,
  expectedRevision,
  value,
});

test('SQL commits multiple documents atomically and a failed later write rolls back the entire transaction', async (t) => {
  const root = await temporary(t),
    store = database(t, root);
  store.commit([
    change('accounts', {admin: 'Owner'}),
    change('assignments', {server: 'one'}),
  ]);
  const injection = new DatabaseSync(store.file);
  injection.exec(
    "CREATE TRIGGER simulated_full_disk BEFORE UPDATE ON documents WHEN new.key='assignments' BEGIN SELECT RAISE(ABORT,'Simulated storage failure'); END",
  );
  injection.close();
  assert.throws(
    () =>
      store.commit([
        change('accounts', {admin: 'Other'}, 1),
        change('assignments', {server: 'two'}, 1),
      ]),
    /Simulated storage failure/,
  );
  assert.deepEqual(store.read('test', 'accounts').value, {admin: 'Owner'});
  assert.deepEqual(store.read('test', 'assignments').value, {server: 'one'});
  assert.equal(store.read('test', 'accounts').revision, 1);
});
test('repository revisions prevent stale writes and delete/recreate cannot reuse an old revision', async (t) => {
  const root = await temporary(t),
    store = database(t, root);
  store.commit([change('settings', {value: 1})]);
  const old = store.read('test', 'settings');
  store.commit([{...change('settings', null, 1), delete: true}]);
  assert.equal(store.read('test', 'settings').exists, false);
  store.commit([change('settings', {value: 2}, 2)]);
  assert.throws(
    () => store.commit([change('settings', {value: 3}, old.revision)]),
    /another writer/,
  );
  assert.equal(store.read('test', 'settings').value.value, 2);
});
test('migration review is read-only; activation preserves every original JSON byte and unknown outcome retries reuse the prepared database', async (t) => {
  const root = await temporary(t),
    users = {
      Owner: {...hashPassword('original account password'), role: 'admin'},
      Assigned: {
        ...hashPassword('member account password'),
        role: 'member',
        grants: {standalone: ['server.view']},
        accessRevision: 4,
      },
    };
  const original = JSON.stringify(users);
  await fs.writeFile(path.join(root, 'users.json'), original);
  const plan = await planStorageMigration(root, 'accounts');
  assert.deepEqual(await fs.readdir(root), ['users.json']);
  assert.doesNotMatch(JSON.stringify(plan), /password|salt|grants/);
  await assert.rejects(
    applyStorageMigration(plan, {confirm: true}),
    /management writers/,
  );
  await assert.rejects(
    applyStorageMigration(plan, {
      confirm: true,
      offline: true,
      publish: async () => {
        throw Error('Simulated activation failure');
      },
    }),
    /activation failure/,
  );
  assert.equal(
    await fs.readFile(path.join(root, 'users.json'), 'utf8'),
    original,
  );
  assert.equal((await fs.readdir(root)).includes(markerName), false);
  const prepared = new SqliteDocumentStore(path.join(root, databaseName)),
    identity = prepared.metadata.identity;
  prepared.close();
  const marker = await applyStorageMigration(plan, {
    confirm: true,
    offline: true,
  });
  assert.equal(marker.identity, identity);
  assert.equal(
    (await applyStorageMigration(plan, {confirm: true, offline: true}))
      .identity,
    identity,
  );
  const accounts = new Accounts(root),
    value = await accounts.users();
  assert.deepEqual(value, users);
  const invite = await accounts.invite('viewer', 'Owner');
  assert.ok(invite.token);
  assert.equal(
    await fs.readFile(path.join(root, 'users.json'), 'utf8'),
    original,
  );
  const stored = await selectedStorage(root);
  assert.equal(
    stored.read('accounts', 'directory').value.users.Assigned.accessRevision,
    4,
  );
});
test('changed migration inputs, unsupported versions and linked input files fail before selecting or overwriting storage', async (t) => {
  const root = await temporary(t);
  await writeJSON(path.join(root, 'users.json'), {});
  const plan = await planStorageMigration(root, 'accounts');
  await writeJSON(path.join(root, 'users.json'), {
    version: 2,
    users: {},
    invitations: {},
  });
  await assert.rejects(
    applyStorageMigration(plan, {confirm: true, offline: true}),
    /state changed/,
  );
  assert.deepEqual((await fs.readdir(root)).sort(), ['users.json']);
  await writeJSON(path.join(root, 'users.json'), {
    version: 99,
    users: {},
    invitations: {},
  });
  await assert.rejects(
    planStorageMigration(root, 'accounts'),
    /Unsupported account storage/,
  );
  const outside = await temporary(t);
  await fs.writeFile(path.join(outside, 'sentinel'), 'private');
  await fs.unlink(path.join(root, 'users.json'));
  await fs.symlink(
    path.join(outside, 'sentinel'),
    path.join(root, 'users.json'),
  );
  await assert.rejects(planStorageMigration(root, 'accounts'), /regular files/);
  assert.equal(
    await fs.readFile(path.join(outside, 'sentinel'), 'utf8'),
    'private',
  );
});
test('two account writers cannot both remove the last administrator or overwrite an access change', async (t) => {
  const root = await temporary(t);
  await writeJSON(path.join(root, 'users.json'), {
    One: {...hashPassword('first administrator password'), role: 'admin'},
    Two: {...hashPassword('second administrator password'), role: 'admin'},
  });
  await applyStorageMigration(await planStorageMigration(root, 'accounts'), {
    confirm: true,
    offline: true,
  });
  let ready = 0,
    release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const repository = () => {
    const repo = new AccountsRepository(root),
      read = repo.read.bind(repo);
    repo.read = async () => {
      const snapshot = await read();
      if (++ready === 2) release();
      await held;
      return snapshot;
    };
    return repo;
  };
  const one = new Accounts(root, {repository: repository()}),
    two = new Accounts(root, {repository: repository()});
  const results = await Promise.allSettled([
    one.update({
      username: 'One',
      operation: 'role',
      role: 'viewer',
      confirm: true,
    }),
    two.update({
      username: 'Two',
      operation: 'role',
      role: 'viewer',
      confirm: true,
    }),
  ]);
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    results.find((result) => result.status === 'rejected').reason.status,
    409,
  );
  const current = await new Accounts(root).users();
  assert.equal(
    Object.values(current).filter((user) => user.role === 'admin').length,
    1,
  );
});
test(
  'separate processes compete on the same revision and only one commit is accepted',
  {timeout: 15000},
  async (t) => {
    const root = await temporary(t),
      store = database(t, root);
    store.commit([change('counter', {count: 0})]);
    const worker = path.join(root, 'writer.mjs');
    await fs.writeFile(
      worker,
      `import {SqliteDocumentStore} from ${JSON.stringify(new URL('../core/storage/sqlite-store.js', import.meta.url).href)}; const store=new SqliteDocumentStore(process.argv[2]); const before=store.read('test','counter'); process.send({ready:true}); process.on('message',()=>{try{store.commit([{namespace:'test',key:'counter',schemaVersion:1,expectedRevision:before.revision,value:{count:before.value.count+1}}]);process.send({outcome:'committed'});}catch(error){process.send({outcome:error.status===409?'conflict':'error'});}finally{store.close();process.disconnect();}});`,
    );
    const children = [
      fork(worker, [store.file], {stdio: ['ignore', 'ignore', 'pipe', 'ipc']}),
      fork(worker, [store.file], {stdio: ['ignore', 'ignore', 'pipe', 'ipc']}),
    ];
    t.after(() => children.forEach((child) => child.kill()));
    await Promise.all(children.map((child) => once(child, 'message')));
    const replies = children.map((child) => once(child, 'message'));
    children.forEach((child) => child.send('commit'));
    const outcomes = (await Promise.all(replies))
      .map(([message]) => message.outcome)
      .sort();
    assert.deepEqual(outcomes, ['committed', 'conflict']);
    assert.equal(store.read('test', 'counter').value.count, 1);
  },
);
test(
  'a process killed inside an SQL transaction leaves committed documents and unrelated world bytes intact',
  {timeout: 15000},
  async (t) => {
    const root = await temporary(t),
      store = database(t, root);
    store.commit([
      change('first', {value: 'before'}),
      change('second', {value: 'before'}),
    ]);
    const world = path.join(root, 'existing-world.zip');
    await fs.writeFile(world, 'untouched world fixture');
    const worker = path.join(root, 'crash.mjs');
    await fs.writeFile(
      worker,
      "import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(process.argv[2]); db.exec('BEGIN IMMEDIATE'); db.prepare(\"UPDATE documents SET value=?,revision=revision+1 WHERE key='first'\").run(JSON.stringify({value:'uncommitted'})); process.send({ready:true}); setInterval(()=>{},1000);",
    );
    const child = fork(worker, [store.file], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    t.after(() => child.kill());
    await once(child, 'message');
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    assert.equal(store.read('test', 'first').value.value, 'before');
    assert.equal(store.read('test', 'second').value.value, 'before');
    assert.equal(await fs.readFile(world, 'utf8'), 'untouched world fixture');
  },
);

test('audit repositories read current history across writers, retry only metadata conflicts and preserve the sequence and chain', async (t) => {
  const root = await temporary(t);
  await new AuditLog(root).append({
    actor: 'Owner',
    action: 'before-migration',
    outcome: 'succeeded',
  });
  const original = await fs.readFile(path.join(root, 'audit.json'), 'utf8');
  await applyStorageMigration(await planStorageMigration(root, 'accounts'), {
    confirm: true,
    offline: true,
  });
  let reads = 0,
    release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const repository = () => {
    const repo = new AuditRepository(root),
      read = repo.read.bind(repo);
    repo.read = async () => {
      const snapshot = await read();
      if (++reads <= 2) {
        if (reads === 2) release();
        await held;
      }
      return snapshot;
    };
    return repo;
  };
  const one = new AuditLog(root, {repository: repository()}),
    two = new AuditLog(root, {repository: repository()});
  await Promise.all([
    one.append({actor: 'One', action: 'parallel', outcome: 'started'}),
    two.append({actor: 'Two', action: 'parallel', outcome: 'started'}),
  ]);
  assert.deepEqual(
    (await one.list()).events.map((event) => event.sequence),
    [3, 2, 1],
  );
  assert.equal((await two.list()).events.length, 3);
  assert.equal(
    await fs.readFile(path.join(root, 'audit.json'), 'utf8'),
    original,
  );
  const store = await selectedStorage(root),
    record = store.read('audit', 'history');
  record.value.events[0].actor = 'Tampered';
  store.commit([
    {
      namespace: 'audit',
      key: 'history',
      schemaVersion: 1,
      expectedRevision: record.revision,
      value: record.value,
    },
  ]);
  await assert.rejects(one.list(), /integrity/);
  await assert.rejects(two.append({action: 'after-corruption'}), /integrity/);
});

test('host registry and setup repositories enforce revisions, retain identity fields and keep the original formats intact', async (t) => {
  const root = await temporary(t),
    initial = {
      version: 1,
      servers: [
        {
          id: 'a'.repeat(32),
          volume: 'keep-existing-fixture-volume',
          controllerToken: 'private fixture token',
          state: 'installed',
        },
      ],
      snapshots: [],
      jobs: [],
    };
  await writeJSON(path.join(root, 'registry.json'), initial);
  await writeJSON(path.join(root, 'host-setup-jobs.json'), [
    {id: 'setup', state: 'failed'},
  ]);
  const original = await fs.readFile(path.join(root, 'registry.json'), 'utf8');
  await applyStorageMigration(await planStorageMigration(root, 'host'), {
    confirm: true,
    offline: true,
  });
  const one = new RegistryRepository(root),
    two = new RegistryRepository(root),
    first = await one.read(),
    stale = await two.read();
  await one.save(first, {
    ...first.value,
    settings: {memoryBudgetGiB: 24, revision: 1},
  });
  await assert.rejects(
    two.save(stale, {
      ...stale.value,
      settings: {memoryBudgetGiB: 8, revision: 1},
    }),
    {status: 409},
  );
  assert.deepEqual((await two.read()).value.servers, initial.servers);
  assert.equal(
    await fs.readFile(path.join(root, 'registry.json'), 'utf8'),
    original,
  );
  const setups = new HostSetupRepository(root),
    snapshot = await setups.read();
  snapshot.value[0].recoveryReview = {acknowledged: true};
  await setups.save(snapshot, snapshot.value);
  assert.equal(
    (await new HostSetupRepository(root).read()).value[0].recoveryReview
      .acknowledged,
    true,
  );
  await assert.rejects(
    new ConfigurationRepository(root, 'schedule', {}).read(),
    /profile/,
  );
});

test('migration reentry validates the selected database and never falls back to old JSON after the marker or database is lost', async (t) => {
  const root = await temporary(t);
  await writeJSON(path.join(root, 'users.json'), {});
  const plan = await planStorageMigration(root, 'accounts');
  await applyStorageMigration(plan, {confirm: true, offline: true});
  const marker = await fs.readFile(path.join(root, markerName));
  await selectedStorage(root);
  await fs.unlink(path.join(root, markerName));
  await assert.rejects(
    new AccountsRepository(root).read(),
    /marker is missing/,
  );
  await fs.writeFile(path.join(root, markerName), marker);
  await fs.rename(
    path.join(root, databaseName),
    path.join(root, 'retained.sqlite'),
  );
  await assert.rejects(
    applyStorageMigration(plan, {confirm: true, offline: true}),
    {code: 'ENOENT'},
  );
  await assert.rejects(new AccountsRepository(root).read(), {code: 'ENOENT'});
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(root, 'users.json'), 'utf8')),
    {},
  );
});

test('invalid audit chains and future registry formats are rejected during migration review before any database is created', async (t) => {
  const root = await temporary(t);
  await writeJSON(path.join(root, 'audit.json'), {
    version: 1,
    anchor: {sequence: 0, hash: '0'.repeat(64)},
    events: [{sequence: 1, previous: '0'.repeat(64), hash: 'invalid'}],
  });
  await assert.rejects(planStorageMigration(root, 'accounts'), /integrity/);
  assert.deepEqual(await fs.readdir(root), ['audit.json']);
  await fs.unlink(path.join(root, 'audit.json'));
  await writeJSON(path.join(root, 'registry.json'), {
    version: 99,
    servers: [],
    snapshots: [],
    jobs: [],
  });
  await assert.rejects(
    planStorageMigration(root, 'host'),
    /Unsupported server registry/,
  );
  assert.deepEqual(await fs.readdir(root), ['registry.json']);
});

test('migrated host services persist budgets, setup history and pairing metadata through repositories without engine mutations', async (t) => {
  const root = await temporary(t),
    fleet = 'a'.repeat(32),
    library = path.join(root, 'library'),
    calls = [];
  await applyStorageMigration(await planStorageMigration(root, 'host'), {
    confirm: true,
    offline: true,
  });
  const manager = new FleetManager({
    root,
    library,
    fleet,
    stateVolume: `lobby-goblin-fleet-${fleet}-state`,
    libraryVolume: `lobby-goblin-fleet-${fleet}-library`,
    image: 'fixture',
    hostContainer: 'fixture',
    docker: async (method, route) => {
      calls.push({method, route});
      assert.equal(method, 'GET');
      assert.equal(route, '/info');
      return {MemTotal: 32 * 1024 ** 3};
    },
  });
  await manager.init();
  await manager.updateHostSettings({memoryBudgetGiB: 24, revision: 0}, 'Owner');
  const hosts = new RemoteHosts(manager);
  await hosts.init();
  t.after(() => hosts.close());
  const enrollment = await hosts.enrollment({operation: 'create'});
  const setup = new HostSetup(hosts, {
    probe: () => assert.fail('No SSH inspection'),
    execute: () => assert.fail('No SSH execution'),
  });
  await setup.init();
  const store = await selectedStorage(root);
  assert.equal(
    store.read('registry', 'host').value.settings.memoryBudgetGiB,
    24,
  );
  assert.equal(
    store.read('registry', 'remote-hosts').value.enrollment.hash.length,
    64,
  );
  assert.equal(enrollment.code.length, 43);
  assert.deepEqual(store.read('operations', 'host-setup').value, []);
  for (const file of [
    'registry.json',
    'host-setup-jobs.json',
    'remote-hosts.json',
  ])
    await assert.rejects(fs.access(path.join(root, file)), {code: 'ENOENT'});
  const competing = new RegistryRepository(root),
    snapshot = await competing.read();
  snapshot.value.settings = {memoryBudgetGiB: 20, revision: 2};
  await competing.save(snapshot, snapshot.value);
  await assert.rejects(
    manager.updateHostSettings({memoryBudgetGiB: 18, revision: 1}, 'Other'),
    {status: 409},
  );
  assert.equal(manager.memoryBudgetGiB, 24);
  assert.ok(calls.every((call) => call.method === 'GET'));
});
