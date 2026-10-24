import {definition} from './definition.js';
const presentation=definition.presentation;
import {assert} from '../../common.js';

export const fields=presentation.screens.find(screen=>screen.id==='settings').options.fields;
const allowed=new Set([...fields.map(field=>field.key),'confirm']);
export function validateServerSettings(params){
  assert(params&&typeof params==='object'&&!Array.isArray(params)&&Object.keys(params).every(key=>allowed.has(key)),'Only the listed server settings can be changed.');
  for(const field of fields){
    if(!Object.hasOwn(params,field.key))continue;
    const value=params[field.key];
    if(field.type==='number')assert(Number.isInteger(value)&&value>=field.min&&value<=field.max,'Invalid '+field.key+'.');
    else if(field.type==='boolean')assert(typeof value==='boolean','Invalid '+field.key+'.');
    else assert(typeof value==='string'&&value.length<=field.max&&(!field.required||value.trim().length>0),'Invalid '+field.key+'.');
  }
  return params;
}
