import {validateBackup} from '../applications/factorio/backup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeZip} from '../core/archive.js';
import {summarizeBackups} from '../core/backup-health.js';
import {validateMap} from '../applications/factorio/map-export.js';

test('backup checks validate nested world data and required settings',()=>{
  const world=makeZip([{name:'Factory/level.dat0',data:Buffer.from('world data')}]);
  const files=[{name:'saves/Factory.zip',data:world},{name:'config/server-settings.json',data:Buffer.from('{}')},{name:'panel-manifest.json',data:Buffer.from('{"activeSave":"Factory.zip"}')}];
  assert.equal(validateBackup(makeZip(files)).worlds,1);
  assert.throws(()=>validateBackup(makeZip(files.filter(item=>!item.name.startsWith('config/')))),/no server settings/);
  const damaged=Buffer.from(world);damaged[30+Buffer.byteLength('Factory/level.dat0')]^=255;
  assert.throws(()=>validateBackup(makeZip([{...files[0],data:damaged},...files.slice(1)])),/integrity/);
  assert.throws(()=>validateBackup(makeZip([...files,{name:'unexpected.txt',data:Buffer.from('x')} ])),/Unexpected/);
});
test('backup health distinguishes stale backups, failures, and verified archives',()=>{
  const value=summarizeBackups([{modified:new Date(Date.now()-3*86400000).toISOString(),size:123,validation:{ok:true,checked:'2026-10-15T01:00:00Z'}}],{enabled:false},[{action:'backup',state:'failed',message:'disk full'}],{freeBytes:500,totalBytes:1000});
  assert.equal(value.totalBytes,123);assert.equal(value.verifiedCount,1);assert.equal(value.alerts.length,3);assert.equal(value.lastAttempt.state,'failed');
});
test('map payload validation rejects incomplete or invalid terrain',()=>{
  const map={version:1,step:2,seed:123,chunks:[{x:0,y:-1,tiles:[1,256]}],palette:[{name:'grass',color:[1,2,3]}],entities:[]};
  assert.equal(validateMap(map),map);
  assert.throws(()=>validateMap({...map,chunks:[{x:0,y:0,tiles:[1,255]}]}),/Incomplete/);
  assert.throws(()=>validateMap({...map,chunks:[{x:0,y:0,tiles:[2,256]}]}),/terrain/);
  assert.throws(()=>validateMap({...map,palette:[{name:'grass',color:[300,20,30]}]}),/map color/);
});
