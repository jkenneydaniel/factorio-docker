import {factorio} from './factorio/index.js';
import {rust} from './rust/index.js';
import {validateGameModule} from '../core/game-module.js';

// The default intentionally needs no new Compose/.env setting. Add future games
// here with their own installation definition and data layout.
const modules=new Map([[factorio.id,factorio],[rust.id,rust]]);
export const registeredGames=()=>[...modules.values()].map(validateGameModule);
export function selectedGame(id='factorio'){
  const module=modules.get(id);
  if(!module)throw new Error('Unsupported game module: '+id);
  return validateGameModule(module);
}
