import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {makeZip,zipEntries,validateWorld,crc32} from '../zip.js';
import {hashPassword,checkPassword,checkOrigin,requireAdmin} from '../auth.js';
import {inside,safeName,redact} from '../common.js';
import {demultiplex} from '../docker.js';

test('backup ZIP round-trips binary save data and configuration',()=>{
  const files=[{name:'saves/Factory.zip',data:Buffer.from([0,1,255,128])},{name:'config/server-settings.json',data:Buffer.from('{"auto_pause":true}')}];
  const entries=zipEntries(makeZip(files));assert.equal(entries.length,2);for(let i=0;i<files.length;i++)assert.deepEqual(entries[i].read(),files[i].data);
});
test('release ZIP preserves executable Unix launchers without changing ordinary backup entries',()=>{
  const buffer=makeZip([{name:'Setup.command',data:Buffer.from('#!/bin/sh\n'),executable:true},{name:'README.md',data:Buffer.from('Read me')}]);
  const first=buffer.indexOf(Buffer.from('504b0102','hex')),second=first+46+Buffer.byteLength('Setup.command');
  assert.equal(buffer.readUInt16LE(first+4)>>>8,3,'Unix creator enables executable permissions on extraction');
  assert.equal(buffer.readUInt32LE(first+38)>>>16,0o100755);
  assert.equal(buffer.readUInt32LE(second+38),0,'ordinary entries retain their prior attributes');
  assert.equal(zipEntries(buffer)[0].read().toString(),'#!/bin/sh\n');
});
test('ZIP integrity failures, traversal, symlinks, and misleading world files are rejected',()=>{
  assert.throws(()=>makeZip([{name:'../escaped',data:Buffer.from('x')}]),/Unsafe/);
  assert.throws(()=>makeZip([{name:'C:/escaped',data:Buffer.from('x')}]),/Unsafe/);
  const original=makeZip([{name:'folder/level.dat0',data:Buffer.from('world')}]);assert.equal(validateWorld(original).length,1);
  const damaged=Buffer.from(original);damaged[30+Buffer.byteLength('folder/level.dat0')]^=255;assert.throws(()=>zipEntries(damaged)[0].read(),/integrity/);
  const symlink=Buffer.from(original);const central=symlink.indexOf(Buffer.from('504b0102','hex'));symlink.writeUInt32LE((0xa1ff<<16)>>>0,central+38);assert.throws(()=>zipEntries(symlink),/Symbolic/);
  assert.throws(()=>validateWorld(makeZip([{name:'not-a-world.txt',data:Buffer.from('x')}])),/Factorio world/);
});
test('ZIP reader accepts deflated files from standard ZIP tools',()=>{
  const content=Buffer.from('Factorio world data '.repeat(20)),name=Buffer.from('test/level.dat0'),compressed=deflateRawSync(content),crc=crc32(content);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(content.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(content.length,24);central.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+compressed.length,16);
  assert.deepEqual(zipEntries(Buffer.concat([local,name,compressed,central,name,end]))[0].read(),content);
});
test('passwords are salted and incorrect credentials fail',()=>{
  const first=hashPassword('correct horse factory'),second=hashPassword('correct horse factory');assert.notEqual(first.hash,second.hash);assert.ok(checkPassword('correct horse factory',first));assert.equal(checkPassword('wrong',first),false);
});
test('same-origin mutations and trusted hosts are required; viewers cannot mutate',()=>{
  checkOrigin({method:'GET',headers:{host:'localhost:8080'}},['localhost']);
  checkOrigin({method:'POST',headers:{host:'localhost:8080',origin:'http://localhost:8080'}},['localhost']);
  assert.throws(()=>checkOrigin({method:'POST',headers:{host:'localhost:8080',origin:'https://attacker.example'}},['localhost']),/origin/);
  assert.throws(()=>checkOrigin({method:'GET',headers:{host:'attacker.example'}},['localhost']),/hostname/);
  assert.throws(()=>requireAdmin({role:'viewer'}),/Administrator/);
});
test('file names, paths, and logs are constrained',()=>{
  assert.equal(safeName('Next factory.zip'),'Next factory');assert.throws(()=>safeName('../escape'));
  assert.throws(()=>inside('/data','../escape'));assert.throws(()=>inside('/data','/elsewhere/file'));
  assert.equal(redact('ok\n+ cat secret\nargs --rcon-password hidden\nSaving finished'),'ok\nSaving finished');
});
test('Docker framed exec output is decoded without frame bytes',()=>{
  const message=Buffer.from('Online players (0):\n'),header=Buffer.alloc(8);header[0]=1;header.writeUInt32BE(message.length,4);assert.equal(demultiplex(Buffer.concat([header,message])),message.toString());
});
