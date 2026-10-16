// Normal map-generator ranges for the pinned Factorio 2.0 server. Display units
// live here so browser controls and controller validation cannot drift apart.
const gen='map_gen_settings.',game='map_settings.';
const number=(path,label,min,max,step=1,hint='',scale=1,fallback=1)=>({path,label,min,max,step,hint,scale,fallback});
const check=(path,label,fallback=false)=>({path,label,boolean:true,fallback});
const percent=(path,label,{off=false,inverse=false,fallback=1}={})=>({...number(path,label,off?0:17,600,1,'',0.01,fallback),slider:true,logarithmic:true,off,positiveMin:100/6,inverse});
const bias=(path,label,hint)=>({...number(path,label,-0.5,0.5,0.01,hint,1,0),slider:true});
export const sections=[
  {name:'Resources',hint:'Frequency, size, and richness use the normal 17–600% range. Move frequency or size to Off to disable a resource.',fields:['iron-ore','copper-ore','stone','coal','uranium-ore','crude-oil'].flatMap(resource=>['frequency','size','richness'].map(key=>percent(gen+'autoplace_controls.'+resource+'.'+key,({'iron-ore':'Iron','copper-ore':'Copper',stone:'Stone',coal:'Coal','uranium-ore':'Uranium','crude-oil':'Oil'})[resource]+' '+key,{off:key!=='richness'})))},
  {name:'Terrain',fields:[number(gen+'width','Map width (tiles)',0,2000000,1,'0 means unlimited.',1,0),number(gen+'height','Map height (tiles)',0,2000000,1,'0 means unlimited.',1,0),percent(gen+'starting_area','Starting area'),percent(gen+'autoplace_controls.water.frequency','Water scale',{inverse:true}),percent(gen+'autoplace_controls.water.size','Water coverage',{off:true}),percent(gen+'autoplace_controls.trees.frequency','Tree scale',{inverse:true}),percent(gen+'autoplace_controls.trees.size','Tree coverage',{off:true}),{...percent(gen+'cliff_settings.cliff_elevation_interval','Cliff frequency',{off:true,fallback:40}),inverse:true,inverseBase:40},percent(gen+'cliff_settings.richness','Cliff continuity',{off:true}),percent(gen+'property_expression_names.control:moisture:frequency','Moisture scale',{inverse:true}),bias(gen+'property_expression_names.control:moisture:bias','Moisture bias','Negative is drier; positive is wetter.'),percent(gen+'property_expression_names.control:aux:frequency','Terrain type scale',{inverse:true}),bias(gen+'property_expression_names.control:aux:bias','Terrain type bias','Controls the balance of terrain types.')]},
  {name:'Enemies',fields:[check(gen+'peaceful_mode','Peaceful mode — enemies attack only when provoked'),check(gen+'no_enemies_mode','No enemies — units do not spawn; nests can remain'),percent(gen+'autoplace_controls.enemy-base.frequency','Enemy base frequency',{off:true}),percent(gen+'autoplace_controls.enemy-base.size','Enemy base size',{off:true}),check(game+'enemy_evolution.enabled','Enemy evolution',true),number(game+'enemy_evolution.time_factor','Evolution time factor',0,1000,1,'Default: 40.',1e-7,0.000004),number(game+'enemy_evolution.destroy_factor','Evolution destroy factor',0,1000,1,'Default: 200.',1e-5,0.002),number(game+'enemy_evolution.pollution_factor','Evolution pollution factor',0,1000,1,'Default: 9.',1e-7,0.0000009),check(game+'enemy_expansion.enabled','Enemy expansion',true),number(game+'enemy_expansion.max_expansion_distance','Expansion distance (chunks)',2,20,1,'',1,7),number(game+'enemy_expansion.settler_group_min_size','Minimum expansion group size',1,20,1,'',1,5),number(game+'enemy_expansion.settler_group_max_size','Maximum expansion group size',1,50,1,'',1,20),number(game+'enemy_expansion.min_expansion_cooldown','Minimum expansion cooldown (minutes)',1,60,1,'',3600,14400),number(game+'enemy_expansion.max_expansion_cooldown','Maximum expansion cooldown (minutes)',5,180,1,'',3600,216000)]},
  {name:'Gameplay & pollution',fields:[number(game+'difficulty_settings.technology_price_multiplier','Research cost multiplier',1,1000,1),number(game+'difficulty_settings.spoil_time_modifier','Spoil time multiplier',0.001,1000,'any','Applies to items that can spoil.'),check(game+'pollution.enabled','Pollution',true),{...number(game+'pollution.diffusion_ratio','Pollution diffusion (%)',0,25,0.1,'Default: 2%.',0.01,0.02),slider:true},number(game+'pollution.ageing','Pollution absorption (%)',0,10000,1,'Default: 100%.',0.01),number(game+'pollution.enemy_attack_pollution_consumption_modifier','Attack pollution cost (%)',0,10000,1,'Default: 100%.',0.01)]},
];
export const fields=sections.flatMap(s=>s.fields);
export const getSetting=(object,path)=>path.split('.').reduce((v,k)=>v?.[k],object);
export function toDisplay(field,value){const n=Number(value);return field.inverse?(n===0?0:(field.inverseBase||1)/n)/field.scale:n/field.scale;}
export function fromDisplay(field,value){const n=Number(value)*field.scale;return field.inverse?(n===0?0:(field.inverseBase||1)/n):field.scale===3600?Math.round(n):Number(n.toPrecision(14));}
export function fieldError(field,value){
  if(field.boolean)return typeof value==='boolean'?null:`${field.label} must be on or off.`;
  if(field.path.includes('property_expression_names.')&&typeof value==='string'&&value.trim()!==''&&!Number.isFinite(Number(value)))return null;
  if(typeof value!=='number'&&!(field.path.includes('property_expression_names.')&&typeof value==='string'&&value.trim()!==''))return `${field.label} must be a number.`;
  const n=toDisplay(field,value),epsilon=1e-6;
  // Factorio stores 1/6 as the lower multiplier and displays it as 17%.
  const low=field.logarithmic?100/6:field.min;
  if(!Number.isFinite(n)||n<low-epsilon&&!(field.off&&n===0)||n>field.max+epsilon)return `${field.label} must be ${field.off?'Off (0) or ':''}${field.logarithmic?'17':field.min}–${field.max}${field.logarithmic?'%':''}.`;
  if(!field.logarithmic&&field.step!=='any'&&Math.abs((n-field.min)/field.step-Math.round((n-field.min)/field.step))>epsilon)return `${field.label} must use steps of ${field.step}.`;
  return null;
}
export function pairError(configuration){
  const expansion=configuration.map_settings?.enemy_expansion;
  if(expansion?.min_expansion_cooldown>expansion?.max_expansion_cooldown)return 'Minimum expansion cooldown must not exceed maximum.';
  if(expansion?.settler_group_min_size>expansion?.settler_group_max_size)return 'Minimum expansion group must not exceed maximum.';
  return null;
}
export function sliderPosition(field,value){const n=toDisplay(field,value);if(field.off&&n===0)return 0;const low=field.positiveMin||field.min,offset=field.off?1:0;return field.logarithmic?offset+100*Math.log(Math.max(low,n)/low)/Math.log(field.max/low):n;}
export function sliderDisplay(field,position){if(field.off&&Number(position)===0)return 0;return field.logarithmic?Math.round(field.positiveMin*Math.pow(field.max/field.positiveMin,(Number(position)-(field.off?1:0))/100)):Number(position);}
