import {assert} from '../../common.js';
import {fields,getSetting,fieldError,pairError} from './public/world-fields.js';

// JSON settings are passed to Factorio's generator, never interpolated into Lua
// or a shell command. Only the two documented world-setting objects are accepted.
export function validateConfiguration(value,{limits=true,draft=false}={}){
  const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  assert(object(value)&&Object.keys(value).every(k=>['map_gen_settings','map_settings'].includes(k)),'Choose valid world settings.');
  assert(object(value.map_gen_settings)&&object(value.map_settings),'World settings need terrain and gameplay objects.');
  assert(JSON.stringify(value).length<=131072,'World settings are too large.');
  const roots={map_gen_settings:['seed','width','height','starting_area','peaceful_mode','no_enemies_mode','autoplace_controls','autoplace_settings','default_enable_all_autoplace_controls','cliff_settings','property_expression_names','starting_points','terrain_segmentation','water'],map_settings:['difficulty_settings','pollution','enemy_evolution','enemy_expansion','unit_group','steering','path_finder','asteroids','max_failed_behavior_count']};
  let count=0;
  function walk(x,depth=0){
    assert(depth<=12&&++count<=10000,'World settings are too complex.');
    if(typeof x==='number')assert(Number.isFinite(x)&&Math.abs(x)<=1e12,'Settings contain an invalid number.');
    else if(typeof x==='string')assert(x.length<=2048&&!/[\x00-\x1f]/.test(x),'Settings contain an invalid value.');
    else if(Array.isArray(x)){assert(x.length<=256,'A settings list is too long.');x.forEach(v=>walk(v,depth+1));}
    else if(object(x))for(const [k,v] of Object.entries(x)){assert(!['__proto__','prototype','constructor'].includes(k)&&k.length<=128,'Invalid settings key.');walk(v,depth+1);}
    else assert(x===null||typeof x==='boolean','Unsupported settings value.');
  }
  walk(value);
  for(const [root,keys] of Object.entries(roots))for(const key of Object.keys(value[root]))assert(keys.includes(key),`Unsupported ${root} option: ${key}.`);
  if(draft)return structuredClone(value);
  const gen=value.map_gen_settings,game=value.map_settings;
  const number=(x,min,max,label,integer=false)=>assert(typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max&&(!integer||Number.isInteger(x)),`Invalid ${label}.`);
  for(const key of ['width','height'])if(key in gen)number(gen[key],0,2000000,`map ${key}`,true);
  if('starting_area' in gen)number(gen.starting_area,0,100,'starting area');
  for(const key of ['peaceful_mode','no_enemies_mode','default_enable_all_autoplace_controls'])if(key in gen)assert(typeof gen[key]==='boolean',`Invalid ${key}.`);
  if(gen.autoplace_controls){assert(object(gen.autoplace_controls),'Invalid resource settings.');for(const control of Object.values(gen.autoplace_controls)){assert(object(control),'Invalid resource control.');for(const [key,x] of Object.entries(control)){assert(['frequency','size','richness'].includes(key),'Unsupported resource setting.');number(x,0,100,'resource '+key);}}}
  if(gen.cliff_settings){assert(object(gen.cliff_settings),'Invalid cliff settings.');for(const key of ['cliff_elevation_interval','richness'])if(key in gen.cliff_settings)number(gen.cliff_settings[key],0,1000000,'cliff '+key);}
  if(gen.property_expression_names)assert(object(gen.property_expression_names)&&Object.values(gen.property_expression_names).every(x=>typeof x==='string'||typeof x==='number'),'Invalid terrain expressions.');
  for(const key of ['pollution','enemy_evolution','enemy_expansion'])if(key in game){assert(object(game[key]),`Invalid ${key} settings.`);if('enabled' in game[key])assert(typeof game[key].enabled==='boolean',`Invalid ${key} toggle.`);}
  for(const key of ['technology_price_multiplier','spoil_time_modifier'])if(game.difficulty_settings&&key in game.difficulty_settings)number(game.difficulty_settings[key],0.001,1000,key);
  const expansion=game.enemy_expansion;if(expansion){for(const key of ['min_expansion_cooldown','max_expansion_cooldown'])if(key in expansion)number(expansion[key],0,2147483647,key,true);if(expansion.min_expansion_cooldown!=null&&expansion.max_expansion_cooldown!=null)assert(expansion.min_expansion_cooldown<=expansion.max_expansion_cooldown,'Minimum expansion cooldown must not exceed maximum.');if(expansion.settler_group_min_size!=null&&expansion.settler_group_max_size!=null)assert(expansion.settler_group_min_size<=expansion.settler_group_max_size,'Minimum expansion group must not exceed maximum.');}
  if(limits){for(const field of fields){const setting=getSetting(value,field.path);if(setting!==undefined){const error=fieldError(field,setting);assert(!error,error);}}const error=pairError(value);assert(!error,error);}
  return structuredClone(value);
}
