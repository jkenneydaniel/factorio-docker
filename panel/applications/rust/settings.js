import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {assert} from '../../common.js';
import {definition} from './definition.js';
const presentation=definition.presentation;

export const fields=presentation.screens.find(screen=>screen.component==='settings').options.fields;
const managed=new Set(fields.map(field=>field.key));
const keyOf=line=>line.trim().split(/\s+/)[0].toLowerCase();
export function validateSettings(input){
  assert(input&&typeof input==='object'&&!Array.isArray(input),'Choose Rust settings.');
  assert(Object.keys(input).length===fields.length&&Object.keys(input).every(key=>managed.has(key)),'Only the listed Rust settings can be changed.');
  for(const field of fields){const value=input[field.key];
    if(field.type==='number')assert(Number.isInteger(value)&&value>=field.min&&value<=field.max,`${field.label} must be between ${field.min} and ${field.max}.`);
    else assert(typeof value==='string'&&value.length<=field.max&&!/[\x00-\x1f\x7f"\\;]/.test(value),`${field.label} contains unsupported characters.`);
  }
  assert(input['server.hostname'].trim().length>0,'Enter a server name.');return input;
}
export function parseSettings(text){
  const values=Object.fromEntries(fields.map(field=>[field.key,field.default])),configured=[];
  for(const line of text.split(/\r?\n/)){
    const key=keyOf(line);if(!managed.has(key))continue;
    const field=fields.find(field=>field.key===key),raw=line.trim().slice(key.length).trim();
    values[key]=field.type==='number'?Number(raw):raw.replace(/^"(.*)"$/,'$1');configured.push(key);
  }
  return {values,configured};
}
export function renderSettings(text,values){
  validateSettings(values);
  const kept=text.split(/\r?\n/).filter(line=>!managed.has(keyOf(line))).join('\n').trimEnd();
  return (kept?kept+'\n':'')+fields.map(field=>`${field.key} ${field.type==='number'?values[field.key]:'"'+values[field.key]+'"'}`).join('\n')+'\n';
}
export async function readSettings(file){
  let text='';try{const stat=await fs.lstat(file);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<1024*1024,'Rust settings must be a regular file smaller than 1 MiB.');text=await fs.readFile(file,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  return {...parseSettings(text),text,revision:crypto.createHash('sha256').update(text).digest('hex')};
}
export async function saveSettings(file,values,revision){
  const current=await readSettings(file);assert(revision===current.revision,'Settings changed. Reload before saving.',409);
  const temporary=file+'.'+crypto.randomBytes(5).toString('hex')+'.tmp';await fs.mkdir(path.dirname(file),{recursive:true});
  try{await fs.writeFile(temporary,renderSettings(current.text,values),{flag:'wx',mode:0o600});await fs.rename(temporary,file);}finally{await fs.unlink(temporary).catch(()=>{});}
}
