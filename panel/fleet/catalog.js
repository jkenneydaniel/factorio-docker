import {registeredApplications} from '../applications/index.js';
import {gameCatalog, validateManagedCreation} from '../core/managed-game.js';
import {assert} from '../common.js';
export {validId, labels, resources} from '../core/instance.js';

export const catalog = Object.freeze(
  Object.fromEntries(
    registeredApplications().map((module) => [module.id, gameCatalog(module)]),
  ),
);
export function validateCreation(input, modules = registeredApplications()) {
  const module = modules.find((module) => module.id === input?.game);
  assert(module, 'Choose a supported game.');
  return validateManagedCreation(input, module);
}
export {noManagedUpdater} from '../core/managed-updater.js';
