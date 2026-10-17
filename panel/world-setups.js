import crypto from 'node:crypto';
import {assert} from './common.js';
import {validateConfiguration} from './world-settings.js';
import {fields} from './public/world-fields.js';

export const emptySetups=()=>({revision:0,draft:null,presets:[]});
const text=(value,max)=>typeof value==='string'&&value.length<=max;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function validateDraft(value){
  assert(object(value)&&JSON.stringify(value).length<=300000,'The draft is too large.');
  assert(text(value.name,80)&&text(value.seed,32)&&text(value.image,256),'Invalid draft details.');
  assert(['defaults','peaceful','copied','preset'].includes(value.base)&&Number.isInteger(value.step)&&value.step>=1&&value.step<=3,'Invalid draft stage.');
  // Keep unfinished input as text, including invalid JSON and empty numeric fields.
  // It is never executed; applying a preset or creating a world validates settings.
  assert(text(value.configuration,131072)&&text(value.advanced,131072)&&typeof value.advancedDirty==='boolean','Invalid draft settings.');
  let configuration;try{configuration=JSON.parse(value.configuration);}catch{assert(false,'Invalid draft configuration.');}
  validateConfiguration(configuration,{draft:true});
  assert(object(value.inputs)&&Object.keys(value.inputs).length<=fields.length,'Invalid draft inputs.');
  for(const [key,input] of Object.entries(value.inputs))assert(fields.some(f=>f.path===key)&&(text(input,128)||typeof input==='boolean'),'Invalid draft input.');
  assert(typeof value.preview==='boolean','Invalid preview preference.');
  return {name:value.name,seed:value.seed,image:value.image,base:value.base,step:value.step,configuration:value.configuration,advanced:value.advanced,advancedDirty:value.advancedDirty,inputs:value.inputs,preview:value.preview,activate:false};
}
export function changeSetups(current,body){
  assert(object(body)&&Number.isSafeInteger(body.revision)&&body.revision===current.revision,'Saved setups changed in another tab. Reload before saving again.',409);
  const next=structuredClone(current);
  if(body.operation==='draft')next.draft={...validateDraft(body.draft),updatedAt:new Date().toISOString(),id:crypto.randomUUID()};
  else if(body.operation==='discard'){
    assert(!body.draftId||body.draftId===next.draft?.id,'A newer draft is available. Reload before discarding it.',409);next.draft=null;
  }else if(body.operation==='save-preset'){
    assert(text(body.name,60)&&body.name.trim().length>0&&!/[\x00-\x1f]/.test(body.name),'Name your preset using 1–60 characters.');
    assert(text(body.image,256),'Invalid game image.');
    const configuration=validateConfiguration(body.configuration),existing=next.presets.find(p=>p.name.toLowerCase()===body.name.trim().toLowerCase());
    assert(!existing,'A preset already uses that name. Choose another name.',409);
    assert(next.presets.length<20,'You can save up to 20 presets. Remove one to make room.');
    // A reusable play style never includes a world name, seed, or activation flag.
    delete configuration.map_gen_settings.seed;
    next.presets.push({id:crypto.randomUUID(),name:body.name.trim(),configuration,image:body.image,updatedAt:new Date().toISOString()});
  }else if(body.operation==='delete-preset'){
    assert(next.presets.some(p=>p.id===body.id),'Preset not found.',404);next.presets=next.presets.filter(p=>p.id!==body.id);
  }else assert(false,'Unsupported saved setup action.');
  next.revision++;return next;
}
