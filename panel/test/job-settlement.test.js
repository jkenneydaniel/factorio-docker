import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForIdleJob} from './fixtures.js';

test('sequential actions wait through terminal-state persistence and another active operation',async()=>{
  const job={id:'requested-job',state:'succeeded',result:'saved'};
  const snapshots=[
    {jobs:[{...job,state:'running'}],active:{id:job.id}},
    {jobs:[job],active:{id:job.id,state:'succeeded'}},
    {jobs:[job],active:{id:'automatic-map-refresh',state:'running'}},
    {jobs:[job],active:null},
  ];
  let reads=0,pauses=0;
  const result=await waitForIdleJob(async()=>{
    assert.ok(reads<snapshots.length,'Polling must finish once the operation lock is released');
    return snapshots[reads++];
  },job.id,{pause:async()=>{pauses++;}});
  assert.equal(reads,4,'A terminal result alone must not start the next action');
  assert.equal(pauses,3);assert.deepEqual(result,job);
});

test('failed operations also release the lock before their failure is returned',async()=>{
  const job={id:'failed-job',state:'failed',message:'Previous saves were restored.'};
  let reads=0;
  const result=await waitForIdleJob(async()=>({jobs:[job],active:++reads===1?job:null}),job.id,{pause:async()=>{}});
  assert.equal(reads,2);assert.equal(result.state,'failed');assert.equal(result.message,job.message);
});

test('a terminal operation that never releases its lock times out instead of being treated as ready',async()=>{
  let reads=0;
  const job={id:'stuck-job',state:'succeeded'};
  await assert.rejects(waitForIdleJob(async()=>{reads++;return {jobs:[job],active:job};},job.id,{attempts:3,pause:async()=>{}}),/release the controller operation lock/);
  assert.equal(reads,3);
});
