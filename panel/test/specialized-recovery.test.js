import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {AuditLog} from '../core/audit.js';
import {AuditRepository} from '../core/storage/state-repositories.js';
import {UpdateManager} from '../applications/factorio/update-manager.js';
import {OperationFeed} from '../core/operation-feed.js';
import {HostSetup} from '../fleet/host-setup.js';
import {workflowJournal} from '../core/workflow-journal.js';
import {setupOperationSource} from '../fleet/operation-sources.js';
import {readJSON, writeJSON, HttpError} from '../common.js';

async function directory(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'lobby-native-recovery-'),
  );
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  return root;
}

test('terminal audit publication reconciles a lost save response and concurrent repeated observations', async (t) => {
  const root = await directory(t),
    repository = new AuditRepository(root);
  const save = repository.save.bind(repository);
  let lost = true;
  repository.save = async (...args) => {
    await save(...args);
    if (lost) {
      lost = false;
      throw Error('Lost committed publication reply');
    }
  };
  const audit = new AuditLog(root, {repository});
  const event = {
    requestId: 'native-id',
    operationId: 'native-id',
    actor: 'Owner',
    scope: 'standalone',
    action: 'operation.panel-update',
    outcome: 'succeeded',
    token: 'private',
  };
  await assert.rejects(audit.appendOnce(event));
  await Promise.all(Array.from({length: 8}, () => audit.appendOnce(event)));
  const events = (await new AuditLog(root).list()).events;
  assert.equal(events.length, 1);
  assert.doesNotMatch(JSON.stringify(events), /private|token/);
  await audit.appendOnce({...event, outcome: 'interrupted'});
  assert.equal((await audit.list()).events.length, 2);
});

test('old interrupted updates retain their fence, require explicit review, and cannot bypass required world recovery', async (t) => {
  const root = await directory(t),
    id = crypto.randomUUID();
  const job = {
    id,
    kind: 'game',
    actor: 'Owner',
    state: 'failed',
    started: '2025-01-01T00:00:00.000Z',
    backup: 'before.zip',
    message: 'Interrupted',
    recovery: {interrupted: true, requiresWorldRestore: true},
  };
  await writeJSON(path.join(root, id + '.json'), job);
  for (let index = 0; index < 35; index++) {
    const retainedId = crypto.randomUUID();
    await writeJSON(path.join(root, retainedId + '.json'), {
      id: retainedId,
      kind: 'panel',
      state: 'succeeded',
      started: '2026-01-01T00:00:00.000Z',
    });
  }
  const effects = [],
    audit = new AuditLog(root);
  const updater = new UpdateManager({
    root,
    now: () => 0,
    current: '0.3.6-alpha',
    record: (event) => audit.appendOnce({...event, scope: 'standalone'}),
    docker: async (method, route) => {
      effects.push({method, route});
      assert.equal(
        method,
        'GET',
        'Recovery must not submit an engine mutation',
      );
      assert.match(route, /update-/);
      throw new HttpError(404, 'Absent fixture worker');
    },
  });
  await updater.init();
  assert.equal(updater.jobs.length, 31);
  assert.equal(updater.pendingRestore.id, id);
  await assert.rejects(updater.plan({kind: 'game'}), /Restore the pre-update/);
  const feed = new OperationFeed({
    scope: 'standalone',
    sources: [updater.operationSource()],
  });
  const recover = (operation) =>
    feed.recover({source: 'updates', id, operation, confirm: true}, 'Reviewer');
  await assert.rejects(recover('acknowledge'), /unavailable/);
  await recover('inspect');
  await assert.rejects(recover('acknowledge'), /unavailable/);
  // The real restore workflow calls this only after a verified explicit restore.
  // This fixture changes metadata only and has no application/world directory.
  await updater.restored('before.zip');
  await assert.rejects(updater.plan({kind: 'game'}), /acknowledge/);
  const reviewed = await recover('acknowledge');
  assert.equal(reviewed.state, 'interrupted');
  assert.equal(reviewed.recovery.required, false);
  assert.equal(updater.pendingReview, undefined);
  assert.equal((await readJSON(path.join(root, id + '.json'))).state, 'failed');
  assert.ok(effects.length > 0);
  assert.ok(
    (await audit.list()).events.some(
      (event) =>
        event.operationId === id &&
        event.action === 'recovery.update.acknowledge',
    ),
  );
});

test('failed asynchronous setup audit publication fences later setup and metadata review never repeats SSH', async (t) => {
  const root = await directory(t);
  let commands = 0,
    paired = 0,
    failed = true;
  const setup = new HostSetup(
    {
      manager: {root},
      add: async () => {
        paired++;
        return {id: 'a'.repeat(32)};
      },
    },
    {
      probe: async () => 'SHA256:' + 'a'.repeat(43),
      execute: async () => {
        commands++;
        return 'Pairing code: ' + 'b'.repeat(43);
      },
      record: async () => {
        if (failed) throw Error('Audit unavailable');
      },
    },
  );
  await setup.init();
  const plan = await setup.plan(
    {
      name: 'Fixture',
      host: 'host.example.test',
      username: 'root',
      useSudo: false,
      installDocker: false,
    },
    'Owner',
  );
  const job = await setup.install(
    {planId: plan.id, confirm: true, auth: {password: 'fixture-only'}},
    'Owner',
  );
  await setup.completion;
  assert.equal(job.state, 'interrupted');
  assert.equal(setup.storageError, true);
  assert.equal(commands, 1);
  assert.equal(paired, 1);
  await assert.rejects(setup.plan({}, 'Owner'), /storage recovery/);
  failed = false;
  const source = setupOperationSource(setup);
  await source.recover({id: job.id, operation: 'inspect'}, 'Reviewer');
  await source.recover(
    {id: job.id, operation: 'acknowledge', confirm: true},
    'Reviewer',
  );
  assert.equal(job.state, 'interrupted');
  assert.equal(job.recoveryReview.acknowledged, true);
  assert.equal(commands, 1);
  assert.equal(paired, 1);
});

test('a native outcome remains unavailable until its audit can be published, without replaying the update', async (t) => {
  const root = await directory(t),
    id = crypto.randomUUID();
  const record = {
    id,
    kind: 'panel',
    state: 'succeeded',
    actor: 'Owner',
    started: '2026-01-01T00:00:00.000Z',
    message: 'Completed',
  };
  const file = path.join(root, id + '.json');
  await writeJSON(file, record);
  const original = await fs.readFile(file);
  let unavailable = true,
    effects = 0;
  const audit = new AuditLog(root);
  const updater = new UpdateManager({
    root,
    current: '0.3.6-alpha',
    now: () => 0,
    docker: async () => {
      effects++;
      throw Error('Unexpected engine access');
    },
    record: (event) => {
      if (unavailable) throw Error('Audit unavailable');
      return audit.appendOnce({...event, scope: 'standalone'});
    },
  });
  const feed = new OperationFeed({
    scope: 'standalone',
    sources: [updater.operationSource()],
  });
  assert.equal((await feed.snapshot()).sources[0].available, false);
  unavailable = false;
  assert.equal((await feed.snapshot()).operations[0].state, 'succeeded');
  await feed.snapshot();
  assert.equal((await audit.list()).events.length, 1);
  assert.equal(effects, 0);
  assert.deepEqual(await fs.readFile(file), original);
});

test('an archived mod/framework completion cannot replace an interrupted current publication or prove parent readiness', async (t) => {
  const root = await directory(t),
    file = path.join(root, 'current.json');
  const journal = workflowJournal({
    file,
    history: path.join(root, 'history'),
    source: 'mods',
    label: 'Mod transactions',
    action: 'mod-change',
  });
  const parent = {id: 'parent-job', actor: 'Owner'};
  const record = {
    id: crypto.randomUUID(),
    phase: 'applying',
    started: '2026-01-01T00:00:00.000Z',
  };
  await journal.write(record, parent);
  const rename = fs.rename;
  fs.rename = async (from, to) => {
    if (to === file) throw Error('Final publication unavailable');
    return rename(from, to);
  };
  record.phase = 'complete';
  try {
    await assert.rejects(journal.write(record), /Final publication/);
  } finally {
    fs.rename = rename;
  }
  const value = (await journal.operationSource.read())[0];
  assert.equal(value.state, 'interrupted');
  assert.equal(value.recovery.required, true);
  assert.equal((await journal.inspect(parent)).outcome, undefined);
  // A metadata repair can publish completion, but still cannot prove that the
  // application's later startup or the parent operation's cleanup succeeded.
  await journal.write(record);
  assert.equal((await journal.operationSource.read())[0].state, 'succeeded');
  assert.equal((await journal.inspect(parent)).outcome, undefined);
});

test('malformed native recovery records fail closed without exposing private JSON fragments', async (t) => {
  const root = await directory(t),
    id = crypto.randomUUID();
  const bytes = '{"privateReplacement":"operator-credential-fixture",broken}';
  const file = path.join(root, id + '.json');
  await fs.writeFile(file, bytes);
  const updater = new UpdateManager({
    root,
    current: '0.3.6-alpha',
    docker: async () => {
      throw Error('Unexpected engine action');
    },
  });
  await assert.rejects(
    updater.refresh(),
    (error) =>
      error.status === 503 &&
      !error.message.includes('operator-credential-fixture'),
  );
  assert.equal(await fs.readFile(file, 'utf8'), bytes);
});
