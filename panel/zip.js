import {inflateRawSync} from 'node:zlib';
import {assert} from './common.js';

const MAX_TOTAL = 512 * 1024 * 1024;
const table = Array.from({length:256}, (_, value) => {
  for (let i=0;i<8;i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const value of buffer) crc = table[(crc ^ value) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function validEntry(name) {
  assert(name && !name.startsWith('/') && !name.includes('\\') && !name.includes('\0') && !/^[A-Za-z]:/.test(name) && !name.split('/').includes('..'), 'Unsafe path in ZIP archive.');
}
export function zipEntries(buffer) {
  assert(buffer.length >= 22 && buffer.length <= MAX_TOTAL, 'Invalid or oversized ZIP archive.');
  let end = -1;
  for (let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i+22+buffer.readUInt16LE(i+20) === buffer.length) { end=i; break; }
  }
  assert(end >= 0, 'ZIP directory was not found.');
  assert(buffer.readUInt16LE(end+4)===0 && buffer.readUInt16LE(end+6)===0, 'Split ZIP archives are not supported.');
  const count = buffer.readUInt16LE(end+10), directorySize = buffer.readUInt32LE(end+12);
  let offset = buffer.readUInt32LE(end+16), total=0;
  assert(count>0 && count<20000 && offset+directorySize<=end, 'Invalid ZIP directory.');
  const result=[], names=new Set();
  for (let i=0;i<count;i++) {
    assert(offset+46<=end && buffer.readUInt32LE(offset)===0x02014b50, 'Invalid ZIP entry.');
    const flags=buffer.readUInt16LE(offset+8), method=buffer.readUInt16LE(offset+10);
    const crc=buffer.readUInt32LE(offset+16), compressed=buffer.readUInt32LE(offset+20), size=buffer.readUInt32LE(offset+24);
    const nameLength=buffer.readUInt16LE(offset+28), extra=buffer.readUInt16LE(offset+30), comment=buffer.readUInt16LE(offset+32);
    const attributes=buffer.readUInt32LE(offset+38), local=buffer.readUInt32LE(offset+42);
    assert(offset+46+nameLength+extra+comment<=end, 'Truncated ZIP entry.');
    const name=buffer.subarray(offset+46,offset+46+nameLength).toString('utf8'); validEntry(name);
    assert(!names.has(name), 'Duplicate path in ZIP archive.'); names.add(name);
    assert(!(flags&1) && [0,8].includes(method), 'Encrypted or unsupported ZIP entry.');
    assert(((attributes>>>16)&0xf000)!==0xa000, 'Symbolic links are not allowed in ZIP archives.');
    total+=size; assert(size<MAX_TOTAL && total<=MAX_TOTAL, 'Uncompressed ZIP archive is too large.');
    assert(local+30<=buffer.length && buffer.readUInt32LE(local)===0x04034b50, 'Invalid ZIP local header.');
    const start=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28);
    assert(start+compressed<=buffer.length, 'Truncated ZIP data.');
    result.push({name,size,read:()=>{
      const data=buffer.subarray(start,start+compressed);
      const output=method===0 ? data : inflateRawSync(data,{maxOutputLength:Math.max(size,1)});
      assert(output.length===size && crc32(output)===crc, 'ZIP data failed its integrity check.'); return output;
    }});
    offset+=46+nameLength+extra+comment;
  }
  return result;
}
export function validateWorld(buffer) {
  const entries=zipEntries(buffer);
  assert(entries.some(entry=>/^[^/]+\/level\.dat(?:0)?$/.test(entry.name)), 'This ZIP does not contain a Factorio world.');
  return entries;
}
export function makeZip(files) {
  const chunks=[], directory=[]; let offset=0,total=0;
  assert(files.length>0 && files.length<20000, 'Too many files for a backup.');
  for (const file of files) {
    validEntry(file.name); total+=file.data.length; assert(total<=MAX_TOTAL, 'Backup exceeds the 512 MB limit.');
    const name=Buffer.from(file.name), crc=crc32(file.data), local=Buffer.alloc(30), central=Buffer.alloc(46);
    const now=new Date(),dosTime=(now.getUTCHours()<<11)|(now.getUTCMinutes()<<5)|Math.floor(now.getUTCSeconds()/2);
    const dosDate=((Math.max(1980,now.getUTCFullYear())-1980)<<9)|((now.getUTCMonth()+1)<<5)|now.getUTCDate();
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt16LE(0x800,6);
    local.writeUInt32LE(crc,14); local.writeUInt32LE(file.data.length,18); local.writeUInt32LE(file.data.length,22); local.writeUInt16LE(name.length,26);
    local.writeUInt16LE(dosTime,10);local.writeUInt16LE(dosDate,12);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6); central.writeUInt16LE(0x800,8);
    central.writeUInt32LE(crc,16); central.writeUInt32LE(file.data.length,20); central.writeUInt32LE(file.data.length,24); central.writeUInt16LE(name.length,28); central.writeUInt32LE(offset,42);
    central.writeUInt16LE(dosTime,12);central.writeUInt16LE(dosDate,14);
    // Release launchers need Unix executable bits when extracted by Finder/unzip.
    if(file.executable===true){central.writeUInt16LE(0x0314,4);central.writeUInt32LE((0o100755<<16)>>>0,38);}
    chunks.push(local,name,file.data); directory.push(central,name); offset+=local.length+name.length+file.data.length;
  }
  const central=Buffer.concat(directory), end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length,8); end.writeUInt16LE(files.length,10); end.writeUInt32LE(central.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...chunks,central,end]);
}
