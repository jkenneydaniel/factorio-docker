import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {sourceFile} from '../source-layout.js';

const panel=fileURLToPath(new URL('../',import.meta.url));
const tests=(await fs.readdir(path.join(panel,'test'))).filter(name=>name.endsWith('.test.js')).sort().map(name=>path.join(panel,'test',name));
tests.push(await sourceFile(path.dirname(panel.replace(/[\\/]$/,'')),'panel/games/rust/image/test-runtime.test.mjs'));
const result=spawnSync(process.execPath,['--test',...process.argv.slice(2),...tests],{cwd:panel,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
