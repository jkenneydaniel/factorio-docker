import test from 'node:test';
import assert from 'node:assert/strict';
import {gameSources,parseGameImage,gameUpdate} from '../public/game-images.js';
import {gameUpdateForm} from '../public/game-update.js';
const owned=gameSources.factory.repository;
test('image references accept only pinned supported repositories and exact revisions',()=>{
  assert.equal(parseGameImage('factoriotools/factorio:2.0.77'),null);
  assert.equal(parseGameImage(owned+':2.0.77-fc.1@sha256:'+'f'.repeat(64)).revision,1);
  for(const reference of ['factoriotools/factorio:latest',owned+':2.0.77',owned+':2.0.77-fc.0',owned+':2.0.077-fc.1',owned+':2.1.1-fc.1','evil.example/'+owned+':2.0.77-fc.1','factoriotools/factorio:2.0.77\n','factoriotools/factorio:2.0.77-fc.1',owned+':2.0.77-fc.9007199254740992'])assert.equal(parseGameImage(reference),null,reference);
});
test('only first-party updates are offered and legacy sources cannot be selected',()=>{
 const current=owned+':2.0.77-fc.1';
 assert.equal(gameUpdate(current,{target:'2.0.78'}).targetImage,owned+':2.0.78-fc.1');
 assert.equal(gameUpdate(current,{target:'2.0.77',imageRevision:2}).operation,'image-change');
 for(const input of [{target:'2.0.76'},{target:'2.0.77'},{target:'2.0.78',source:'upstream'},{target:'2.1.22'},{target:'2.0.78',imageRevision:0}])assert.throws(()=>gameUpdate(current,input));
 assert.throws(()=>gameUpdate('factoriotools/factorio:2.0.77',{target:'2.0.78'}),/migrate first/);
});
test('image selection keeps the current provider and revision and disables unrecognized installations',()=>{
  assert.match(gameUpdateForm(owned+':2.0.77-fc.3'),/value="factory" selected/);
  assert.match(gameUpdateForm(owned+':2.0.77-fc.3'),/value="3"/);
  assert.doesNotMatch(gameUpdateForm('factoriotools/factorio:2.0.77'),/value="upstream"/);
  assert.match(gameUpdateForm('custom/server:latest'),/reviewed host upgrade/);
  assert.match(gameUpdateForm('custom/server:latest'),/<select name="source" aria-label="Image source" disabled/);
});
