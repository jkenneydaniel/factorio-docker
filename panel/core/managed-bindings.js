import {assert} from '../common.js';
const definitions = new WeakMap();
export function registerManagedBinding(managed, definition, imagePolicy) {
  definitions.set(managed, {definition, imagePolicy});
}
export function validateManagedBinding(module) {
  if (!module.definition) return;
  const bound = definitions.get(module.managed);
  assert(
    bound?.definition === module.definition &&
      bound.imagePolicy === module.imagePolicy,
    'Managed adapter and image policy must use their registered application definition.',
  );
}
