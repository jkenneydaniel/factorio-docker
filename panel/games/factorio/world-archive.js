import {zipEntries} from '../../core/archive.js';
import {assert} from '../../common.js';

export function validateWorld(buffer) {
  const entries=zipEntries(buffer);
  assert(entries.some(entry=>/^[^/]+\/level\.dat(?:0)?$/.test(entry.name)), 'This ZIP does not contain a Factorio world.');
  return entries;
}
