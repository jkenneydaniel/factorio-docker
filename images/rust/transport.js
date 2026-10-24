// Reuse the module transport in checkouts and historical release layouts.
import {existsSync} from 'node:fs';
const source=new URL('../../panel/applications/rust/transport.js',import.meta.url);
export const {createWebRcon}=await import(existsSync(source)?source:new URL('../../../applications/rust/transport.js',import.meta.url));
