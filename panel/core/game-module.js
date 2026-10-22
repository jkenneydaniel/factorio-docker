import {assert} from '../common.js';
import {validateManagedGame} from './managed-game.js';

// Built-in modules are trusted application code, not downloaded plugins. Keep
// selection and route exposure explicit rather than importing an environment path.
export function validateGameModule(module){
  assert(module&&/^[a-z][a-z0-9-]*$/.test(module.id),'Invalid game module.');
  assert(typeof module.name==='string'&&module.name.length>0,'A game module needs a name.');
  for(const key of ['configuration','createController','createUpdater','diagnostics'])assert(typeof module[key]==='function',`Game module needs ${key}.`);
  assert(Array.isArray(module.routes)&&module.routes.every(route=>/^\/[a-z][a-z0-9-]*$/.test(route)),'Invalid game routes.');
  assert(new Set(module.routes).size===module.routes.length,'Duplicate game routes.');
  assert(module.web&&typeof module.web.Accounts==='function'&&module.web.assets,'Game module needs a web definition.');
  if(module.managed)validateManagedGame(module);
  return module;
}
