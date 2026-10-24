import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {HostSetup} from '../fleet/host-setup.js';
import {setupOperationSource} from '../fleet/operation-sources.js';
const input = {
  name: 'Disposable host',
  host: 'host.example.test',
  username: 'root',
  domain: 'host.example.test',
  memory: 16,
  useSudo: false,
  installDocker: false,
};
async function fixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'lobby-setup-durability-')),
  );
  let calls = 0;
  const setup = new HostSetup(
    {
      manager: {root},
      add: async () => {
        calls++;
        return {id: 'a'.repeat(32)};
      },
    },
    {
      probe: async () => 'SHA256:' + 'a'.repeat(43),
      execute: async () => 'Pairing code: ' + 'b'.repeat(43),
    },
  );
  t.after(async () => {
    await setup.completion;
    await setup.writes;
    await fs.rm(root, {recursive: true, force: true});
  });
  await setup.init();
  const plan = await setup.plan(input, 'Owner');
  return {setup, plan, source: setupOperationSource(setup), calls: () => calls};
}
const install = ({setup, plan}) =>
  setup.install(
    {planId: plan.id, confirm: true, auth: {password: 'disposable secret'}},
    'Owner',
  );

test(
  'native host setup remains running and blocks another setup until its final outcome is durable',
  {timeout: 10000},
  async (t) => {
    let release = () => {},
      started;
    t.after(() => release());
    const fixtureState = await fixture(t),
      {setup, source} = fixtureState,
      save = setup.repository.save.bind(setup.repository);
    const held = new Promise((resolve) => {
        release = resolve;
      }),
      saving = new Promise((resolve) => {
        started = resolve;
      });
    setup.repository.save = async (snapshot, jobs) => {
      if (jobs[0]?.state === 'succeeded') {
        started();
        await held;
      }
      return save(snapshot, jobs);
    };
    const job = await install(fixtureState);
    await saving;
    assert.equal(job.state, 'running');
    assert.equal(setup.active, job);
    assert.equal((await source.read())[0].state, 'running');
    assert.equal(job.phase, 'recording-outcome');
    await assert.rejects(setup.plan(input, 'Owner'), /in progress/);
    assert.equal(fixtureState.calls(), 1);
    release();
    await setup.completion;
    assert.equal(setup.active, null);
    assert.equal(job.state, 'succeeded');
    assert.equal(
      JSON.parse(await fs.readFile(setup.file))[0].state,
      'succeeded',
    );
  },
);

test('failed final setup persistence preserves uncertainty, fences new setup and supports metadata review without replaying SSH', async (t) => {
  const fixtureState = await fixture(t),
    {setup, source} = fixtureState,
    save = setup.repository.save.bind(setup.repository);
  setup.repository.save = async (snapshot, jobs) => {
    if (jobs[0]?.state === 'succeeded')
      throw Error('Injected final save failure');
    return save(snapshot, jobs);
  };
  const job = await install(fixtureState);
  await setup.completion;
  assert.equal(job.state, 'interrupted');
  assert.equal(setup.storageError, true);
  assert.equal((await source.read())[0].recovery.required, true);
  assert.equal(JSON.parse(await fs.readFile(setup.file))[0].state, 'running');
  await assert.rejects(setup.plan(input, 'Owner'), /storage recovery/);
  assert.equal(fixtureState.calls(), 1);
  await source.recover(
    {id: job.id, operation: 'inspect', confirm: true},
    'Reviewer',
  );
  assert.equal(setup.storageError, false);
  assert.equal(job.state, 'interrupted');
  assert.equal(fixtureState.calls(), 1);
  assert.equal(
    JSON.parse(await fs.readFile(setup.file))[0].state,
    'interrupted',
  );
});

test(
  'an older setup review queued during terminal persistence cannot overwrite the new setup outcome',
  {timeout: 10000},
  async (t) => {
    let release = () => {},
      started;
    t.after(() => release());
    const fixtureState = await fixture(t),
      {setup, source} = fixtureState;
    const previous = {
      id: 'c'.repeat(32),
      state: 'failed',
      name: 'Previous fixture',
      actor: 'Owner',
      started: new Date().toISOString(),
      message: 'Needs review',
    };
    setup.jobs.push(previous);
    await setup.persist();
    const save = setup.repository.save.bind(setup.repository),
      held = new Promise((resolve) => {
        release = resolve;
      }),
      saving = new Promise((resolve) => {
        started = resolve;
      });
    setup.repository.save = async (snapshot, jobs) => {
      if (jobs[0]?.state === 'succeeded') {
        started();
        await held;
      }
      return save(snapshot, jobs);
    };
    const current = await install(fixtureState);
    await saving;
    const reviewing = source.recover(
      {id: previous.id, operation: 'inspect', confirm: true},
      'Reviewer',
    );
    release();
    await Promise.all([setup.completion, reviewing]);
    const records = JSON.parse(await fs.readFile(setup.file));
    assert.equal(
      records.find((job) => job.id === current.id).state,
      'succeeded',
    );
    assert.equal(
      records.find((job) => job.id === previous.id).recoveryReview.checkedBy,
      'Reviewer',
    );
    assert.equal(current.state, 'succeeded');
  },
);
