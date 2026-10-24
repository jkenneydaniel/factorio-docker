import {registeredDefinitions} from './registry.js';
import {assert} from '../common.js';
import {validateApplicationModule} from '../core/application-module.js';

const modules = new Map();
for (const definition of registeredDefinitions()) {
  const {default: module} = await import('./' + definition.id + '/index.js');
  validateApplicationModule(module);
  assert(
    module.definition === definition,
    'Application adapter must use its registered package definition.',
  );
  modules.set(definition.id, module);
}
export const registeredApplications = () =>
  [...modules.values()].map(validateApplicationModule);
export function selectedApplication(id = 'factorio') {
  const module = modules.get(id);
  if (!module) throw new Error('Unsupported application: ' + id);
  return validateApplicationModule(module);
}
