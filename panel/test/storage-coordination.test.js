import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {
  withStorageLock,
  inspectStorageLock,
  recoverStorageLock,
} from '../core/storage/coordination.js';
import {
  planStorageMigration,
  applyStorageMigration,
} from '../core/storage/migrations.js';
import {closeStorage} from '../core/storage/selection.js';
import {writeJSON} from '../common.js';
import {AccountsRepository} from '../core/storage/document-repository.js';
async function fixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'lobby-storage-lock-')),
  );
  t.after(async () => {
    await closeStorage(root);
    await fs.rm(root, {recursive: true, force: true});
  });
  return root;
}

test(
  'legacy repository writers in separate processes cannot both pass a stale byte revision check',
  {timeout: 15000},
  async (t) => {
    const root = await fixture(t);
    await writeJSON(path.join(root, 'users.json'), {Owner: {role: 'admin'}});
    const file = path.join(root, 'legacy-writer.mjs');
    await fs.writeFile(
      file,
      `import {AccountsRepository} from ${JSON.stringify(new URL('../core/storage/document-repository.js', import.meta.url).href)};const repo=new AccountsRepository(process.argv[2]),snapshot=await repo.read();process.send({ready:true});process.on('message',async()=>{try{snapshot.value.users.Owner.name=process.argv[3];await repo.save(snapshot,snapshot.value);process.send({outcome:'committed'});}catch(error){process.send({outcome:error.status===409?'conflict':'error'});}finally{process.disconnect();}});`,
    );
    const children = ['One', 'Two'].map((name) =>
      fork(file, [root, name], {stdio: ['ignore', 'ignore', 'pipe', 'ipc']}),
    );
    t.after(() => children.forEach((child) => child.kill()));
    await Promise.all(children.map((child) => once(child, 'message')));
    const replies = children.map((child) => once(child, 'message'));
    children.forEach((child) => child.send('save'));
    assert.deepEqual(
      (await Promise.all(replies)).map(([message]) => message.outcome).sort(),
      ['committed', 'conflict'],
    );
    assert.equal(await inspectStorageLock(root), null);
    assert.ok(
      ['One', 'Two'].includes(
        JSON.parse(await fs.readFile(path.join(root, 'users.json'))).users.Owner
          .name,
      ),
    );
  },
);

test(
  'a killed coordination owner requires reviewed offline recovery and cannot modify unrelated bytes',
  {timeout: 15000},
  async (t) => {
    const root = await fixture(t),
      world = path.join(root, 'existing-world.zip');
    await fs.writeFile(world, 'unchanged world fixture');
    const file = path.join(root, 'lock-holder.mjs');
    await fs.writeFile(
      file,
      `import {withStorageLock} from ${JSON.stringify(new URL('../core/storage/coordination.js', import.meta.url).href)};await withStorageLock(process.argv[2],'write',async()=>{process.send({ready:true});await new Promise(()=>setInterval(()=>{},1000));});`,
    );
    const child = fork(file, [root], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    t.after(() => child.kill());
    await once(child, 'message');
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    const review = await inspectStorageLock(root);
    assert.equal(review.owner.purpose, 'write');
    await assert.rejects(
      withStorageLock(
        root,
        'write',
        () => assert.fail('A stale lock cannot be bypassed'),
        {timeout: 20},
      ),
      {status: 503},
    );
    await assert.rejects(
      recoverStorageLock(root, review, {confirm: true}),
      /writers are stopped/,
    );
    await assert.rejects(
      recoverStorageLock(
        root,
        {...review, owner: {...review.owner, token: 'b'.repeat(36)}},
        {confirm: true, offline: true},
      ),
      {status: 409},
    );
    assert.deepEqual(
      await recoverStorageLock(root, review, {confirm: true, offline: true}),
      {cleared: true},
    );
    assert.equal(await inspectStorageLock(root), null);
    assert.equal(await fs.readFile(world, 'utf8'), 'unchanged world fixture');
  },
);

test('migration waits for a cooperating writer then rejects a plan made before its committed change', async (t) => {
  const root = await fixture(t);
  await writeJSON(path.join(root, 'users.json'), {Owner: {role: 'admin'}});
  const plan = await planStorageMigration(root, 'accounts');
  let ready, release;
  const started = new Promise((resolve) => {
      ready = resolve;
    }),
    held = new Promise((resolve) => {
      release = resolve;
    });
  const writer = withStorageLock(root, 'write', async () => {
    ready();
    await held;
    await writeJSON(path.join(root, 'users.json'), {
      Owner: {role: 'admin', name: 'New state'},
    });
  });
  await started;
  const migrating = applyStorageMigration(plan, {confirm: true, offline: true});
  release();
  await writer;
  await assert.rejects(migrating, /state changed/);
  await assert.rejects(fs.access(path.join(root, 'panel-storage.json')), {
    code: 'ENOENT',
  });
  assert.equal(
    JSON.parse(await fs.readFile(path.join(root, 'users.json'))).Owner.name,
    'New state',
  );
});

test('nested metadata writes share the outer lease and inherited background work cannot bypass release', async (t) => {
  const root = await fixture(t);
  let later, release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await withStorageLock(root, 'write', async () => {
    const before = await inspectStorageLock(root);
    await withStorageLock(root, 'write', async () =>
      assert.equal(
        (await inspectStorageLock(root)).owner.token,
        before.owner.token,
      ),
    );
    later = (async () => {
      await held;
      await withStorageLock(root, 'write', async () =>
        assert.notEqual(
          (await inspectStorageLock(root)).owner.token,
          before.owner.token,
        ),
      );
    })();
  });
  release();
  await later;
  assert.equal(await inspectStorageLock(root), null);
});

test('failed lease cleanup does not report a durable metadata commit as failed or allow another writer to bypass review', async (t) => {
  const root = await fixture(t);
  await writeJSON(path.join(root, 'users.json'), {Owner: {role: 'admin'}});
  const repository = new AccountsRepository(root),
    snapshot = await repository.read(),
    remove = fs.rmdir.bind(fs),
    messages = [];
  let fail = true;
  t.mock.method(console, 'error', (message) => messages.push(message));
  t.mock.method(fs, 'rmdir', async (directory, ...args) => {
    if (fail && path.basename(directory) === '.panel-storage-lock') {
      fail = false;
      throw Object.assign(Error('Injected cleanup failure'), {code: 'EBUSY'});
    }
    return remove(directory, ...args);
  });
  snapshot.value.users.Owner.name = 'Committed';
  await repository.save(snapshot, snapshot.value);
  assert.equal((await repository.read()).value.users.Owner.name, 'Committed');
  assert.equal(messages.length, 1);
  const review = await inspectStorageLock(root);
  assert.equal(review.owner, null);
  await assert.rejects(
    withStorageLock(
      root,
      'write',
      () => assert.fail('Interrupted lease must be reviewed'),
      {timeout: 20},
    ),
    {status: 503},
  );
  await recoverStorageLock(root, review, {confirm: true, offline: true});
  assert.equal(await inspectStorageLock(root), null);
  assert.equal((await repository.read()).value.users.Owner.name, 'Committed');
});

test('a truncated coordination owner remains reviewable without exposing its bytes and needs the exact offline review to clear', async (t) => {
  const root = await fixture(t),
    directory = path.join(root, '.panel-storage-lock');
  await fs.mkdir(directory, {mode: 0o700});
  await fs.writeFile(
    path.join(directory, 'owner.json'),
    '{"private":"must-not-be-output",',
    {mode: 0o600},
  );
  const review = await inspectStorageLock(root);
  assert.equal(review.owner, null);
  assert.equal(review.incomplete, true);
  assert.equal(review.ownerHash.length, 64);
  assert.ok(!JSON.stringify(review).includes('must-not-be-output'));
  await assert.rejects(
    recoverStorageLock(
      root,
      {...review, ownerHash: 'a'.repeat(64)},
      {confirm: true, offline: true},
    ),
    {status: 409},
  );
  await recoverStorageLock(root, review, {confirm: true, offline: true});
  assert.equal(await inspectStorageLock(root), null);
});
