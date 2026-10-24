import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Operations} from '../core/operations.js';
import {readJSON, writeJSON} from '../common.js';

async function fixture(t, initial = [], inspect) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lobby-operations-')),
    file = path.join(root, 'jobs.json');
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  let jobs = structuredClone(initial),
    active = null,
    failure = () => false;
  const persist = async () => {
    if (failure(jobs)) throw Error('Simulated storage failure');
    await writeJSON(file, jobs);
  };
  const service = new Operations({
    getJobs: () => jobs,
    setJobs: (value) => {
      jobs = value;
    },
    getActive: () => active,
    setActive: (value) => {
      active = value;
    },
    persist,
    inspect,
    retryable: (job) => ['start', 'stop'].includes(job.action),
  });
  await service.init();
  return {
    service,
    file,
    get jobs() {
      return jobs;
    },
    get active() {
      return active;
    },
    failWhen: (fn) => {
      failure = fn;
    },
  };
}
const input = {
  action: 'start',
  actor: 'Owner',
  input: {confirm: true},
  requestId: 'browser-request-123456',
};

test('concurrent duplicates wait for the initial reservation write and share its failure', async (t) => {
  for (const fail of [false, true]) {
    const f = await fixture(t),
      persist = f.service.persist;
    let release;
    const held = new Promise((resolve, reject) => {
      release = () => (fail ? reject(Error('Reservation failed')) : resolve());
    });
    f.service.persist = async () => {
      await held;
      await persist();
    };
    const first = f.service.reserve(input),
      second = f.service.reserve(input);
    const results = Promise.allSettled([first, second]);
    let accepted = false;
    void second.then(
      () => {
        accepted = true;
      },
      () => {},
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(accepted, false);
    release();
    const values = await results;
    if (fail) {
      assert.ok(values.every((value) => value.status === 'rejected'));
      assert.equal(f.active, null);
      assert.equal(f.jobs.length, 0);
    } else {
      assert.ok(values.every((value) => value.status === 'fulfilled'));
      assert.equal(values[0].value.job.id, values[1].value.job.id);
    }
  }
});

test('operation checkpoints precede effects and keep the lock through cleanup and final persistence', async (t) => {
  const f = await fixture(t),
    {job} = await f.service.reserve(input),
    order = [];
  await f.service.execute(job, {
    before: async () => {
      assert.equal((await readJSON(f.file))[0].phase, 'preparing');
      order.push('before');
    },
    run: async () => {
      assert.equal((await readJSON(f.file))[0].phase, 'executing');
      order.push('effect');
      return 'Ready';
    },
    after: async () => {
      assert.equal(f.active, job);
      assert.equal((await readJSON(f.file))[0].phase, 'cleanup');
      order.push('cleanup');
    },
  });
  assert.deepEqual(order, ['before', 'effect', 'cleanup']);
  assert.equal(f.active, null);
  const stored = (await readJSON(f.file))[0];
  assert.equal(stored.state, 'succeeded');
  assert.equal(stored.phase, 'settled');
  assert.ok(stored.finished);
});

test('initial persistence failure rolls back reservation and permits a fresh request', async (t) => {
  const f = await fixture(t),
    before = structuredClone(f.jobs);
  f.failWhen(() => true);
  await assert.rejects(f.service.reserve(input), /storage failure/);
  assert.deepEqual(f.jobs, before);
  assert.equal(f.active, null);
  f.failWhen(() => false);
  assert.equal((await f.service.reserve(input)).duplicate, false);
});

test('duplicate requests return the same job during execution and after restart without storing inputs', async (t) => {
  const f = await fixture(t),
    request = {
      ...input,
      input: {secret: 'not-for-operation-history', confirm: true},
    },
    first = await f.service.reserve(request);
  assert.equal((await f.service.reserve(request)).job, first.job);
  for (const changed of [
    {actor: 'Other'},
    {action: 'stop'},
    {input: {confirm: false}},
  ])
    await assert.rejects(
      f.service.reserve({...request, ...changed}),
      /different request/,
    );
  await assert.rejects(
    f.service.reserve({...input, requestId: 'too-short'}),
    /request ID/,
  );
  let effects = 0;
  await f.service.execute(first.job, {
    run: async () => {
      effects++;
      return 'Done';
    },
  });
  const text = await fs.readFile(f.file, 'utf8');
  assert.ok(!text.includes('not-for-operation-history'));
  const restarted = await fixture(t, JSON.parse(text));
  assert.equal((await restarted.service.reserve(request)).job.id, first.job.id);
  assert.equal(effects, 1);
});

test('a different request cannot race a persisted reservation', async (t) => {
  const f = await fixture(t);
  const pending = f.service.reserve(input);
  await assert.rejects(
    f.service.reserve({...input, requestId: 'another-browser-request'}),
    /in progress/,
  );
  await pending;
  assert.equal(f.jobs.length, 1);
});

test('restart converts unfinished work into reviewable records without replaying anything', async (t) => {
  let inspections = 0;
  const f = await fixture(
    t,
    [
      {
        id: 'old',
        action: 'backup',
        state: 'succeeded',
        message: 'Legacy completed job',
      },
      {
        id: 'running',
        action: 'restart',
        state: 'running',
        phase: 'executing',
      },
      {id: 'cleanup', action: 'start', state: 'succeeded', phase: 'cleanup'},
      {id: 'queued', action: 'stop', state: 'queued'},
    ],
    async () => {
      inspections++;
      return {message: 'Review the logs.'};
    },
  );
  assert.equal(inspections, 0);
  assert.equal(f.jobs[0].state, 'succeeded');
  assert.equal(f.service.pending.length, 3);
  assert.equal(f.jobs[2].recovery.interruptedPhase, 'cleanup');
  assert.equal(f.service.blocked, true);
  await assert.rejects(f.service.reserve(input), /Review interrupted/);
  await assert.rejects(
    f.service.recover(
      {id: 'running', operation: 'acknowledge', confirm: true},
      'Owner',
    ),
    /Check the outcome/,
  );
  assert.equal(
    f.service.storageError,
    false,
    'Invalid review input is not a storage failure',
  );
  await f.service.recover({id: 'running', operation: 'inspect'}, 'Owner');
  assert.equal(inspections, 1);
  await f.service.recover(
    {id: 'running', operation: 'acknowledge', confirm: true},
    'Owner',
  );
  assert.equal(f.jobs[1].state, 'interrupted');
  assert.equal(f.jobs[1].recovery.reviewedBy, 'Owner');
});

test('completion persistence and cleanup failures require recovery and never become unhandled rejections', async (t) => {
  for (const kind of ['storage', 'cleanup']) {
    const f = await fixture(t),
      {job} = await f.service.reserve(input);
    let effects = 0,
      failed = false;
    f.failWhen(
      (jobs) =>
        kind === 'storage' &&
        jobs[0].phase === 'settled' &&
        !failed &&
        (failed = true),
    );
    await f.service.execute(job, {
      run: async () => {
        effects++;
        return 'Changed';
      },
      after: async () => {
        if (kind === 'cleanup') throw Error('Cleanup incomplete');
      },
    });
    assert.equal(effects, 1);
    assert.equal(f.active, null);
    assert.equal(job.state, 'interrupted');
    assert.equal(job.recovery.required, true);
    await assert.rejects(
      f.service.reserve({...input, requestId: 'another-browser-request'}),
      /Review interrupted|Check recovery/,
    );
    assert.equal((await readJSON(f.file))[0].recovery.required, true);
  }
});

test('reconciliation only marks success when its inspector proves the requested outcome', async (t) => {
  const f = await fixture(
    t,
    [{id: 'start', action: 'start', state: 'running'}],
    async () => ({
      outcome: 'succeeded',
      message: 'Server readiness is verified.',
    }),
  );
  const result = await f.service.recover(
    {id: 'start', operation: 'inspect'},
    'Owner',
  );
  assert.equal(result.state, 'succeeded');
  assert.equal(result.recovery.state, 'verified');
  assert.equal(f.service.blocked, false);
  assert.equal((await readJSON(f.file))[0].phase, 'settled');
});

test('only inspected safe actions can be retried; the new reservation links and resolves the original atomically', async (t) => {
  const f = await fixture(
    t,
    [{id: 'start', action: 'start', state: 'running'}],
    async () => ({message: 'The server is stopped.'}),
  );
  await assert.rejects(
    f.service.reserve({...input, retryOf: 'start'}),
    /Check the interrupted/,
  );
  await f.service.recover({id: 'start', operation: 'inspect'}, 'Owner');
  f.failWhen(() => true);
  await assert.rejects(
    f.service.reserve({...input, retryOf: 'start'}),
    /storage failure/,
  );
  assert.equal(f.service.pending.length, 1);
  f.failWhen(() => false);
  const {job} = await f.service.reserve({...input, retryOf: 'start'});
  assert.equal(job.retryOf, 'start');
  assert.equal(
    f.jobs.find((value) => value.id === 'start').recovery.retryJobId,
    job.id,
  );
  await f.service.execute(job, {run: async () => 'Started'});
  assert.equal(f.service.pending.length, 0);
  assert.equal(
    (await f.service.reserve({...input, retryOf: 'start'})).job.id,
    job.id,
    'A lost retry response cannot execute twice',
  );
});

test('audit reservations precede effects and an unrecorded outcome requires recovery',async()=>{
 let jobs=[],active=null,effects=0,fail=true;const events=[];
 const operations=new Operations({getJobs:()=>jobs,setJobs:value=>{jobs=value;},getActive:()=>active,setActive:value=>{active=value;},persist:async()=>{},record:async event=>{if(fail)throw Error('Audit unavailable');events.push(event);}});
 await assert.rejects(operations.reserve({action:'save',actor:'Owner',input:{}}),/Audit unavailable/);assert.equal(active,null);assert.equal(jobs.length,0);
 fail=false;const {job}=await operations.reserve({action:'save',actor:'Owner',input:{}});assert.equal(events[0].outcome,'started');
 fail=true;await operations.execute(job,{run:async()=>{effects++;return 'Saved';}});
 assert.equal(effects,1);assert.equal(job.state,'interrupted');assert.equal(operations.blocked,true);assert.equal(active,null);
});
