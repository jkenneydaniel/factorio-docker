import test from 'node:test';
import assert from 'node:assert/strict';
import {jsonWithComments,archiveText,mergeSettings} from '../engine-settings.js';

import {settingsTar} from './fixtures.js';
test('installed engine settings parse comments/strings and read only the requested TAR member',()=>{
  assert.deepEqual(jsonWithComments('{ // note\n "url":"https://example.test/a//b", /* note */ "value":[1,2,],}'),{url:'https://example.test/a//b',value:[1,2]});
  assert.deepEqual(jsonWithComments('{"text":",}","value":1, // trailing comment\n}'),{text:',}',value:1});
  assert.deepEqual(JSON.parse(archiveText(settingsTar({pollution:{min_to_diffuse:15}}),'map-settings.example.json')),{pollution:{min_to_diffuse:15}});
  assert.throws(()=>archiveText(Buffer.alloc(512),'map-settings.example.json'),/not found/);
  const broken=settingsTar({});broken.write('77777777777',124);assert.throws(()=>archiveText(broken,'map-settings.example.json'),/Invalid/);
});
test('compact chosen settings retain engine-required fields and override nested defaults independently',()=>{
  const base={pollution:{enabled:true,min_to_diffuse:15},path_finder:{use_path_cache:true}};
  const chosen={pollution:{enabled:false}},result=mergeSettings(base,chosen);
  assert.deepEqual(result,{pollution:{enabled:false,min_to_diffuse:15},path_finder:{use_path_cache:true}});
  result.pollution.min_to_diffuse=99;assert.equal(base.pollution.min_to_diffuse,15);assert.deepEqual(chosen,{pollution:{enabled:false}});
});
