import {assert} from '../common.js';
const frozen = new WeakSet();
export const isFrozenDefinition = (value) =>
  !!value && typeof value === 'object' && frozen.has(value);

export function definitionData(value) {
  const active = new Set();
  let nodes = 0;
  function visit(item, depth) {
    assert(
      ++nodes <= 20000 && depth <= 32,
      'Application definition is too large or deeply nested.',
    );
    if (item === null || typeof item === 'boolean' || typeof item === 'string')
      return;
    if (typeof item === 'number') {
      assert(
        Number.isFinite(item),
        'Application definition numbers must be finite.',
      );
      return;
    }
    assert(
      item &&
        typeof item === 'object' &&
        (Array.isArray(item) ||
          [Object.prototype, null].includes(Object.getPrototypeOf(item))) &&
        !active.has(item),
      'Application definitions must contain JSON data only.',
    );
    assert(
      Object.getOwnPropertySymbols(item).length === 0 &&
        (!Array.isArray(item) ||
          (item.length <= 20000 &&
            Object.keys(item).length === item.length &&
            Object.keys(item).every((key, index) => key === String(index)))),
      'Application definitions need ordinary JSON arrays and fields.',
    );
    active.add(item);
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(item),
    )) {
      if (Array.isArray(item) && key === 'length') continue;
      assert(
        !['__proto__', 'prototype', 'constructor'].includes(key) &&
          Object.hasOwn(descriptor, 'value') &&
          descriptor.enumerable,
        'Unsafe application definition field.',
      );
      visit(descriptor.value, depth + 1);
    }
    active.delete(item);
  }
  visit(value, 0);
  assert(
    Buffer.byteLength(JSON.stringify(value)) <= 1024 * 1024,
    'Application definition exceeds 1 MiB.',
  );
  return value;
}
export function freezeDefinition(value) {
  definitionData(value);
  const copy = structuredClone(value);
  const freeze = (item) => {
    if (item && typeof item === 'object') {
      for (const child of Object.values(item)) freeze(child);
      Object.freeze(item);
    }
    return item;
  };
  freeze(copy);
  frozen.add(copy);
  return copy;
}
