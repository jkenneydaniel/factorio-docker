import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setup} from './applications/factorio/setup.js';
import {verifyUpdaterRuntime} from './image-readiness.js';
export {setup} from './applications/factorio/setup.js';

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    await verifyUpdaterRuntime();
    console.log('Updater prerequisites verified.');
    await setup(process.env.SETUP_ROOT||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),process.argv.slice(2),{url:process.env.PANEL_URL||'http://localhost:8080',ownership:process.getuid?.()===0});
  }
  catch(error){console.error('Setup: '+error.message);process.exitCode=1;}
}
