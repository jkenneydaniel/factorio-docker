import {previewHTML,mountWorldPreview} from './world-preview.js';
import {sections,fields,getSetting,toDisplay,fromDisplay,fieldError,pairError,sliderPosition,sliderDisplay} from './world-fields.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>JSON.parse(JSON.stringify(value));
const get=getSetting;
function put(object,path,value){const parts=path.split('.'),last=parts.pop();for(const part of parts)object=object[part]??={};object[last]=value;}
let draft=null;
export function clearWorldDraft(){draft=null;}
export function useCopiedSettings(){if(draft){draft.base='copied';draft.configuration=null;}}
const canCopy=options=>options?.copied?.sourceWorld===options?.currentWorld&&options?.copied?.image===options?.image;
function fieldHTML(field,configuration){const value=get(configuration,field.path)??field.fallback,index=fields.indexOf(field),id='world-field-'+index;
  if(field.boolean)return `<label class="check-label"><input type="checkbox" data-world-setting="${esc(field.path)}" ${value?'checked':''}>${esc(field.label)}</label>`;
  let numeric=toDisplay(field,value);
  if(!Number.isFinite(numeric))return `<p class="form-note">${esc(field.label)} uses a custom expression. Edit it under Advanced settings.</p>`;
  if(field.logarithmic)numeric=Math.round(numeric);
  else numeric=Number(numeric.toPrecision(12));
  const attrs=`data-world-setting="${esc(field.path)}"`,percent=field.logarithmic?' (%)':'',input=`<input type="number" id="${id}" aria-label="${esc(field.label+(field.logarithmic?' (%)':''))}" aria-describedby="${id}-hint" ${attrs} value="${esc(numeric)}" min="${field.min}" max="${field.max}" step="${field.step}" required>`;
  if(!field.slider)return `<label for="${id}">${esc(field.label)}${input}<span class="hint" id="${id}-hint">${esc(field.hint||`${field.min}–${field.max}${field.step===1?' · whole numbers':''}`)}</span></label>`;
  const display=displayValue(field,numeric),bounds=field.logarithmic?(field.off?'Off or 17–600%':'17–600%'):`${field.min}–${field.max}`;
  return `<div class="world-slider-field"><div class="world-slider-heading"><label for="${id}">${esc(field.label+percent)}</label><output for="${id}" data-world-output="${esc(field.path)}">${esc(display)}</output></div><input type="range" aria-label="${esc(field.label)} slider" aria-valuetext="${esc(display)}" data-world-range="${esc(field.path)}" min="${field.logarithmic?0:field.min}" max="${field.logarithmic?(field.off?101:100):field.max}" step="${field.logarithmic?1:field.step}" value="${Math.max(field.logarithmic?0:field.min,Math.min(field.logarithmic?(field.off?101:100):field.max,sliderPosition(field,value)))}">${input}<span class="hint" id="${id}-hint">${esc(field.hint||bounds)}</span></div>`;
}
function displayValue(field,n){return field.off&&n===0?'Off':String(n)+(field.logarithmic||field.label.includes('(%)')?'%':'');}
function settingsHTML(configuration){return sections.map(section=>`<details class="world-section" ${section.name==='Resources'?'open':''}><summary>${section.name}</summary>${section.hint?`<p class="form-note">${section.hint}</p>`:''}<div class="world-settings-grid">${section.fields.map(field=>fieldHTML(field,configuration)).join('')}</div></details>`).join('')+`<details class="world-section"><summary>Advanced settings</summary><p class="form-note">Edit the complete terrain and gameplay configuration, including placement rules, starting points, pollution, unit groups, and pathfinding. Apply changes to update the controls above. The separate Seed field always takes precedence.</p><label>Full world settings (JSON)<textarea id="world-settings-json" class="settings-json" spellcheck="false">${esc(JSON.stringify(configuration,null,2))}</textarea></label><button type="button" class="button" id="apply-world-json">Apply advanced settings</button><p id="world-json-result" class="hint" role="status"></p></details>`;}
function baselineNote(options){return (draft.base==='copied'&&canCopy(options)?'Copied from '+options.copied.sourceWorld+'.':'Starting from Factorio defaults.')+' Changing starting settings resets the options below.';}
export function worldForm(options,busy=false){
  if(!draft)draft={base:canCopy(options)?'copied':'defaults',name:'',seed:'',preview:true,activate:false,configuration:null};
  if(!draft.configuration)draft.configuration=clone(draft.base==='copied'&&canCopy(options)?options.copied.configuration:options.defaults);
  return `<form id="create-form"><p class="form-note">Choose your starting settings, then customize your new world. Your current world keeps running until you choose to switch.</p><div class="form-grid"><label>World name<input name="name" required maxlength="80" placeholder="Our-next-factory" value="${esc(draft.name)}"></label><label>Seed<span class="world-seed-choice"><input name="seed" aria-label="Seed" type="number" min="1" max="4294967295" step="1" placeholder="Random seed" value="${esc(draft.seed)}"><button type="button" class="button small" id="roll-world-seed">New seed</button></span></label></div><div class="world-base"><label>Starting settings<select id="world-base" aria-label="Starting settings"><option value="copied" ${draft.base==='copied'?'selected':''} ${canCopy(options)?'':'disabled'}>Copy current world</option><option value="defaults" ${draft.base==='defaults'?'selected':''}>Factorio defaults</option></select></label><button type="button" id="copy-world-settings" class="button" ${busy?'disabled':''}>${canCopy(options)?'Refresh':'Load'} current world settings</button></div><p class="form-note" id="world-base-note">${esc(baselineNote(options))}</p><div class="world-build-layout"><div id="world-editor-settings">${settingsHTML(draft.configuration)}</div>${previewHTML}</div><p class="world-achievement-note">These settings are applied when the new world is generated. No Lua commands run on the fresh world. Peaceful mode, reduced enemy settings, and other choices can make some achievements unavailable.</p><label class="check-label"><input name="preview" type="checkbox" ${draft.preview?'checked':''}>Keep a preview in the world library</label><label class="check-label"><input name="activate" type="checkbox" ${draft.activate?'checked':''}>Switch to this world when it’s ready</label><p id="world-form-error" class="error" role="alert"></p><button class="button primary" ${busy?'disabled':''}>Create world →</button></form>`;
}
export function bindWorldEditor(options,{startJob,confirmAction,toast,api}){
  const form=document.querySelector('#create-form');if(!form)return;
  let advancedDirty=false,previewChanged=()=>{};
  function basics(){const data=new FormData(form);for(const k of ['name','seed'])draft[k]=data.get(k);for(const k of ['preview','activate'])draft[k]=data.has(k);}
  function bindFields(){
    advancedDirty=false;
    const inputs=Array.from(form.querySelectorAll('[data-world-setting]'));
    function validateInputs(){
      const candidate=clone(draft.configuration);let message='';
      for(const input of inputs){const field=fields.find(f=>f.path===input.dataset.worldSetting);input.setCustomValidity('');const value=field.boolean?input.checked:input.value===''?NaN:fromDisplay(field,input.value),error=fieldError(field,value);if(error){input.setCustomValidity(error);message||=error;}else put(candidate,field.path,value);}
      const pair=pairError(candidate);if(pair){const suffix=pair.includes('cooldown')?'max_expansion_cooldown':'settler_group_max_size',input=inputs.find(i=>i.dataset.worldSetting.endsWith(suffix));input?.setCustomValidity(pair);message||=pair;}
      form.querySelector('#world-form-error').textContent=message;
      return message;
    }
    function applyInput(input,field){
      const value=field.boolean?input.checked:input.value===''?NaN:fromDisplay(field,input.value),error=fieldError(field,value);
      if(!error){put(draft.configuration,field.path,field.path.includes('property_expression_names.')?String(value):value);const range=form.querySelector(`[data-world-range="${field.path}"]`);if(range){range.value=sliderPosition(field,value);const text=displayValue(field,Number(input.value));range.setAttribute('aria-valuetext',text);form.querySelector(`[data-world-output="${field.path}"]`).textContent=text;}if(!advancedDirty)form.querySelector('#world-settings-json').value=JSON.stringify(draft.configuration,null,2);}
      validateInputs();
    }
    for(const input of inputs){const field=fields.find(f=>f.path===input.dataset.worldSetting);input.addEventListener('input',()=>applyInput(input,field));const range=form.querySelector(`[data-world-range="${field.path}"]`);range?.addEventListener('input',()=>{input.value=sliderDisplay(field,range.value);applyInput(input,field);});}
    validateInputs();
    form.querySelector('#world-settings-json').addEventListener('input',()=>{advancedDirty=true;});
    form.querySelector('#apply-world-json').addEventListener('click',()=>{
      try{const value=JSON.parse(form.querySelector('#world-settings-json').value);if(!value||typeof value!=='object'||!value.map_gen_settings||!value.map_settings||Object.keys(value).some(k=>!['map_gen_settings','map_settings'].includes(k)))throw new Error('Include map_gen_settings and map_settings objects.');if(JSON.stringify(value).length>131072)throw new Error('Settings are too large.');for(const field of fields){const setting=get(value,field.path);if(setting!==undefined){const error=fieldError(field,setting);if(error)throw new Error(error);}}const pair=pairError(value);if(pair)throw new Error(pair);draft.configuration=value;form.querySelector('#world-editor-settings').innerHTML=settingsHTML(value);bindFields();form.querySelector('#world-settings-json').closest('details').open=true;form.querySelector('#world-json-result').textContent='Advanced settings applied. The controls above now match.';previewChanged();}
      catch(error){form.querySelector('#world-json-result').textContent='Could not apply settings: '+error.message;}
    });
  }
  bindFields();form.addEventListener('invalid',event=>{for(let details=event.target.closest('details');details;details=details.parentElement.closest('details'))details.open=true;},true);form.addEventListener('input',basics);form.addEventListener('change',basics);
  form.querySelector('#world-base').addEventListener('change',event=>{draft.base=event.target.value;form.querySelector('#world-base-note').textContent=baselineNote(options);draft.configuration=clone(draft.base==='copied'?options.copied.configuration:options.defaults);form.querySelector('#world-editor-settings').innerHTML=settingsHTML(draft.configuration);bindFields();});
  form.querySelector('#copy-world-settings').addEventListener('click',async()=>{basics();if(await confirmAction('Load current world settings?','This refreshes your starting settings from an isolated saved copy. Terrain and gameplay edits in this form will be replaced. Your world name and seed will be kept.'))startJob('world-options');});
  previewChanged=mountWorldPreview(form,{api,getDraft:()=>draft,isValid:()=>!advancedDirty});
  form.querySelector('#roll-world-seed').addEventListener('click',()=>{form.elements.seed.value='';draft.seed='';previewChanged();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();basics();if(advancedDirty){form.querySelector('#world-form-error').textContent='Apply your advanced settings before creating the world.';return;}
    if(draft.activate&&!await confirmAction('Create and load a new world?','The current world will be saved and backed up before switching. Players will be disconnected when the new world is ready.'))return;
    form.querySelector('#world-form-error').textContent='';await startJob('create',{name:draft.name,seed:draft.seed,preview:draft.preview,activate:draft.activate,confirm:draft.activate,configuration:clone(draft.configuration)});
  });
}
