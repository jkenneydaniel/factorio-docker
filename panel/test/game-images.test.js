import test from 'node:test';
import assert from 'node:assert/strict';
import {gameSources,parseGameImage,gameUpdate} from '../public/game-images.js';
import {gameUpdateForm} from '../public/game-update.js';
const owned=gameSources.factory.repository;
test('image references accept only pinned supported repositories and exact revisions',()=>{
  assert.equal(parseGameImage('factoriotools/factorio:2.0.77').source,'upstream');
  assert.equal(parseGameImage(owned+':2.0.77-fc.1@sha256:'+'f'.repeat(64)).revision,1);
  for(const reference of ['factoriotools/factorio:latest',owned+':2.0.77',owned+':2.0.77-fc.0',owned+':2.0.077-fc.1',owned+':2.1.1-fc.1','evil.example/'+owned+':2.0.77-fc.1','factoriotools/factorio:2.0.77\n','factoriotools/factorio:2.0.77-fc.1',owned+':2.0.77-fc.9007199254740992'])assert.equal(parseGameImage(reference),null,reference);
});
test('existing installations keep their source, same-version migrations are explicit and downgrades are refused',()=>{
  const upstream='factoriotools/factorio:2.0.77',factory=owned+':2.0.77-fc.1';
  assert.equal(gameUpdate(upstream,{target:'2.0.78'}).targetImage,'factoriotools/factorio:2.0.78');
  assert.equal(gameUpdate(factory,{target:'2.0.78'}).source,'factory');
  assert.equal(gameUpdate(upstream,{target:'2.0.77',source:'factory'}).operation,'image-change');
  assert.equal(gameUpdate(factory,{target:'2.0.77',source:'upstream'}).targetImage,upstream);
  assert.equal(gameUpdate(factory,{target:'2.0.77',imageRevision:2}).targetImage,owned+':2.0.77-fc.2');
  for(const input of [{target:'2.0.76',source:'factory'},{target:'2.0.77'},{target:'2.0.78',source:'https://evil.example'},{target:'2.1.22'},{target:'2.0.78',source:'factory',imageRevision:0},{target:'2.0.78',source:'upstream',imageRevision:1}])assert.throws(()=>gameUpdate(upstream,input));
  assert.throws(()=>gameUpdate(owned+':2.0.77-fc.3',{target:'2.0.77',imageRevision:2}),/newer/);
  assert.throws(()=>gameUpdate('custom/server:2.0.77',{target:'2.0.78'}),/pinned/);
});
test('image selection keeps the current provider and revision and disables unrecognized installations',()=>{
  assert.match(gameUpdateForm(owned+':2.0.77-fc.3'),/value="factory" selected/);
  assert.match(gameUpdateForm(owned+':2.0.77-fc.3'),/value="3"/);
  assert.match(gameUpdateForm('factoriotools/factorio:2.0.77'),/value="upstream" selected/);
  assert.match(gameUpdateForm('custom/server:latest'),/reviewed host upgrade/);
  assert.match(gameUpdateForm('custom/server:latest'),/<select name="source" aria-label="Image source" disabled/);
});
