import test from 'node:test';
import assert from 'node:assert/strict';
import {WorldPreviews,previewKey} from '../world-preview.js';
const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(24)]);
const input=(seed=123)=>({configuration:{map_gen_settings:{width:0,height:0,autoplace_controls:{coal:{size:1}}},map_settings:{pollution:{enabled:true}}},seed,image:'factorio:2.0.77'});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('preview fingerprints ignore gameplay-only settings, pin seed/image, and canonicalize key order',()=>{
  const a=input(),b=input();b.configuration.map_settings.pollution.enabled=false;assert.equal(previewKey(a.configuration,a.seed,a.image),previewKey(b.configuration,b.seed,b.image));
  b.configuration.map_gen_settings={autoplace_controls:{coal:{size:1}},height:0,width:0};assert.equal(previewKey(a.configuration,a.seed,a.image),previewKey(b.configuration,b.seed,b.image));
  assert.notEqual(previewKey(a.configuration,1,a.image),previewKey(a.configuration,2,a.image));assert.notEqual(previewKey(a.configuration,1,a.image),previewKey(a.configuration,1,'another-image'));
});
test('preview queue renders once, coalesces slider changes, caches results and isolates accounts',async()=>{
  let release;const seen=[];const previews=new WorldPreviews({render:async value=>{seen.push(value.seed);if(seen.length===1)await new Promise(resolve=>{release=resolve;});return png;}});
  const first=previews.request('alice',input(1));assert.equal(first.state,'rendering');previews.request('alice',input(2));const latest=previews.request('alice',input(3));assert.equal(latest.state,'queued');assert.deepEqual(seen,[1]);
  release();await flush();await previews.waitIdle();await flush();assert.deepEqual(seen,[1,3]);assert.equal(previews.status('alice').state,'ready');assert.equal(previews.image('alice',latest.id),png);assert.throws(()=>previews.image('bob',latest.id),/no longer current/);
  assert.equal(previews.request('bob',input(3)).state,'ready');assert.deepEqual(seen,[1,3]);assert.throws(()=>previews.image('alice',first.id),/no longer current/);
});
test('busy world operations defer previews, failures retry, and preview cache expires',async()=>{
  let busy=true,fail=true,now=100;const previews=new WorldPreviews({canRun:()=>!busy,now:()=>now,ttl:100,render:async()=>{if(fail)throw new Error('bad terrain');return png;}});
  assert.equal(previews.request('alice',input()).state,'queued');busy=false;await previews.tick();assert.equal(previews.status('alice').state,'error');fail=false;previews.request('alice',input());await flush();await previews.waitIdle();assert.equal(previews.status('alice').state,'ready');now+=101;assert.equal(previews.status('alice').state,'idle');
});
