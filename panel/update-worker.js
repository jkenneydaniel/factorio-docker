// Stable entrypoint used by existing detached update workers.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runUpdate} from './games/factorio/update-worker.js';
export * from './games/factorio/update-worker.js';
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runUpdate({root:process.env.UPDATE_ROOT,state:process.env.UPDATE_STATE||'/updates',id:process.env.UPDATE_JOB}).catch(()=>{console.error('Update worker could not start. Check retained update state locally.');process.exitCode=1;});
}
