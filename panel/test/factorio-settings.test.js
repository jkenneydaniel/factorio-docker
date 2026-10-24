import test from 'node:test';
import assert from 'node:assert/strict';
import {definition} from '../applications/factorio/definition.js';
const presentation=definition.presentation;
import {fields,validateServerSettings} from '../applications/factorio/settings.js';

test('Factorio settings use the same declared types and bounds on the server and browser',()=>{
  assert.equal(fields,presentation.screens.find(screen=>screen.id==='settings').options.fields);
  const values={name:'Existing installation',description:'',max_players:0,autosave_interval:5,autosave_slots:10,auto_pause:true,require_user_verification:false,game_password:'',clear_password:false,confirm:true};
  assert.deepEqual(validateServerSettings(values),values);validateServerSettings({autosave_interval:60,confirm:true});
  for(const change of [{name:''},{name:'x'.repeat(101)},{max_players:'10'},{max_players:1001},{autosave_interval:0},{autosave_slots:101},{game_password:'x'.repeat(101)},{clear_password:'yes'},{auto_pause:1},{visibility:{public:true}},{rcon_password:'unreviewed'}])assert.throws(()=>validateServerSettings({...values,...change}));
});
