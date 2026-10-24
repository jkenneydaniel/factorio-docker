import test from 'node:test';
import assert from 'node:assert/strict';
import {StatusMetadata} from '../applications/factorio/status-metadata.js';
const server={Id:'fixture',Image:'sha256:fixture',State:{StartedAt:'first-start'}};

test('status metadata expires and refreshes for a new process, image, world, or invalidation',async()=>{
  let now=0,calls=[];const cache=new StatusMetadata({now:()=>now});
  const query=async command=>{calls.push(command);return command==='/seed'?'123':'Version: 2.0.77';};
  assert.deepEqual(await cache.get(server,'A.zip',query),{seed:'123',version:'Version: 2.0.77'});
  await cache.get(server,'A.zip',query);assert.equal(calls.length,2);
  now=30000;await cache.get(server,'A.zip',query);assert.equal(calls.length,4);
  const restarted={...server,State:{StartedAt:'second-start'}};
  await cache.get(restarted,'A.zip',query);assert.equal(calls.length,6);
  const replaced={...restarted,Id:'replacement',Image:'sha256:new'};
  await cache.get(replaced,'A.zip',query);assert.equal(calls.length,8);
  await cache.get(replaced,'B.zip',query);assert.equal(calls.length,10);
  cache.clear();await cache.get(replaced,'B.zip',query);assert.equal(calls.length,12);
  assert.deepEqual(calls,Array.from({length:6},()=>['/seed','/version']).flat());
});

test('concurrent reads share one query and failed metadata is retried',async()=>{
  const cache=new StatusMetadata();let calls=0,release;
  const first=cache.get(server,'A.zip',async()=>{calls++;if(calls===1)await new Promise(resolve=>release=resolve);return 'value';});
  const second=cache.get(server,'A.zip',()=>assert.fail('duplicate query'));release();
  assert.deepEqual(await first,await second);assert.equal(calls,2);
  cache.clear();await assert.rejects(cache.get(server,'A.zip',async()=>{throw Error('offline');}),/offline/);
  assert.deepEqual(await cache.get(server,'A.zip',async command=>command),{seed:'/seed',version:'/version'});
});

test('an old pending response cannot overwrite metadata after clearing or switching worlds',async()=>{
  const cache=new StatusMetadata();let release;
  const old=cache.get(server,'A.zip',async command=>{if(command==='/seed')await new Promise(resolve=>release=resolve);return 'old';});
  cache.clear();const current=await cache.get(server,'B.zip',async()=> 'new');release();await old;
  assert.deepEqual(await cache.get(server,'B.zip',()=>assert.fail('old response poisoned cache')),current);
});
