import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {validateConfiguration} from '../world-settings.js';
import {fields,toDisplay,fromDisplay,sliderDisplay,sliderPosition} from '../public/world-fields.js';
const defaults=JSON.parse(await fs.readFile(new URL('../world-defaults.json',import.meta.url),'utf8'));
test('world configuration preserves all advanced settings and returns an independent copy',()=>{
  const chosen=structuredClone(defaults);chosen.map_gen_settings.autoplace_controls['iron-ore']={frequency:2,size:3,richness:6};chosen.map_gen_settings.peaceful_mode=true;chosen.map_settings.difficulty_settings.technology_price_multiplier=2;chosen.map_settings.enemy_expansion.min_expansion_cooldown=18000;
  const result=validateConfiguration(chosen);assert.deepEqual(result,chosen);result.map_gen_settings.width=100;assert.equal(chosen.map_gen_settings.width,0);
});
test('world settings reject malformed types, unsafe keys, excessive values and contradictory expansion rules',()=>{
  for(const value of [null,[],{...defaults,server_settings:{}},{...defaults,map_gen_settings:{width:-1}},{...defaults,map_gen_settings:{height:2.5}},{...defaults,map_gen_settings:{peaceful_mode:'true'}},{...defaults,map_gen_settings:{autoplace_controls:{coal:{frequency:'6'}}}},{...defaults,map_settings:{enemy_expansion:{enabled:'false'}}},{...defaults,map_settings:{difficulty_settings:{technology_price_multiplier:0}}},{...defaults,map_settings:{enemy_expansion:{min_expansion_cooldown:100,max_expansion_cooldown:1}}},{...defaults,map_settings:{enemy_expansion:{settler_group_min_size:20,settler_group_max_size:5}}},{...defaults,map_gen_settings:{property_expression_names:{water:'x'.repeat(2049)}}},{...defaults,map_settings:{path_finder:JSON.parse('{"__proto__":{"polluted":true}}')}}])assert.throws(()=>validateConfiguration(value));
  assert.equal({}.polluted,undefined);
});
test('normal generator bounds are enforced by the controller, including JSON submissions',()=>{
  const withGen=changes=>({...structuredClone(defaults),map_gen_settings:{...structuredClone(defaults.map_gen_settings),...changes}});
  for(const value of [0,1/6,1,6])assert.doesNotThrow(()=>validateConfiguration(withGen({autoplace_controls:{'iron-ore':{frequency:value,size:1,richness:1}}})));
  for(const value of [-1,.16,6.01,100])assert.throws(()=>validateConfiguration(withGen({autoplace_controls:{'iron-ore':{frequency:value,size:1,richness:1}}})),/frequency/);
  assert.throws(()=>validateConfiguration(withGen({autoplace_controls:{'iron-ore':{richness:0}}})),/richness/);
  assert.throws(()=>validateConfiguration(withGen({starting_area:7})),/Starting area/);
  assert.throws(()=>validateConfiguration(withGen({property_expression_names:{'control:moisture:bias':'0.51'}})),/Moisture bias/);
  const withGame=changes=>({...structuredClone(defaults),map_settings:{...structuredClone(defaults.map_settings),...changes}});
  for(const change of [{enemy_expansion:{max_expansion_distance:1}},{enemy_expansion:{max_expansion_distance:21}},{enemy_expansion:{settler_group_min_size:21}},{enemy_expansion:{settler_group_max_size:51}},{enemy_expansion:{settler_group_max_size:2.5}},{enemy_expansion:{min_expansion_cooldown:3600*61}},{enemy_expansion:{max_expansion_cooldown:3600*181}},{enemy_expansion:{min_expansion_cooldown:3600*1.5}},{enemy_evolution:{time_factor:.001}},{pollution:{diffusion_ratio:.251}},{difficulty_settings:{technology_price_multiplier:1.5}}])assert.throws(()=>validateConfiguration(withGame(change)));
  assert.doesNotThrow(()=>validateConfiguration(withGame({enemy_expansion:{max_expansion_distance:20,settler_group_min_size:20,settler_group_max_size:50,min_expansion_cooldown:60*3600,max_expansion_cooldown:180*3600}})));
});
test('sliders preserve percentages, off states, inverse terrain scales and gameplay units',()=>{
  const field=path=>fields.find(f=>f.path===path),iron=field('map_gen_settings.autoplace_controls.iron-ore.frequency');
  assert.equal(sliderDisplay(iron,0),0);assert.equal(sliderDisplay(iron,1),17);assert.equal(sliderDisplay(iron,51),100);assert.equal(sliderDisplay(iron,101),600);
  assert.equal(sliderPosition(iron,1),51);assert.equal(fromDisplay(iron,600),6);assert.equal(toDisplay(iron,6),600);
  const water=field('map_gen_settings.autoplace_controls.water.frequency'),cliffs=field('map_gen_settings.cliff_settings.cliff_elevation_interval');
  assert.equal(fromDisplay(water,200),.5);assert.equal(toDisplay(water,.5),200);assert.equal(fromDisplay(cliffs,200),20);assert.equal(fromDisplay(cliffs,0),0);assert.equal(toDisplay(cliffs,40),100);
  assert.equal(toDisplay(field('map_settings.enemy_evolution.time_factor'),.000004),40);
  assert.equal(fromDisplay(field('map_settings.enemy_expansion.min_expansion_cooldown'),4),14400);
  assert.equal(fromDisplay(field('map_settings.pollution.diffusion_ratio'),2),.02);
});
