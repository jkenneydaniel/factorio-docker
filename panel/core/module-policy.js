import {assert} from '../common.js';
import {permissionCatalogFor} from './permissions.js';
import {sharedControllerEndpoints} from './routes.js';

// Declarations are trusted, reviewed application code. They cannot replace core
// administrative routes or lift broker limits. Requests never register policy.
export function validateModulePolicy(module) {
  const {contract} = module;
  if (contract.version === 1 && !contract.policy) return; // historical third-party/test v1 callers
  const {policy, actions, routes, screens} = contract;
  assert(
    policy && typeof policy === 'object',
    'Module contract v2 requires an access policy.',
  );
  const object = (value) =>
    value && typeof value === 'object' && !Array.isArray(value);
  assert(
    policy.version === 1 && object(policy.permissions) && object(policy.routes),
    'Invalid module access policy.',
  );
  for (const [name, label] of Object.entries(policy.permissions))
    assert(
      (name.startsWith('application.' + module.id + '.') ||
        ((!module.definition || module.definition.kind === 'game') &&
          name.startsWith('game.' + module.id + '.'))) &&
        /^(?:game|application)\.[a-z][a-z0-9-]*\.[a-z][a-z0-9.-]{0,63}$/.test(
          name,
        ) &&
        typeof label === 'string' &&
        label.length > 0 &&
        label.length <= 200,
      'Invalid namespaced application permission.',
    );
  assert(
    Object.keys(policy.permissions).length <= 64,
    'Too many module permissions.',
  );
  const catalog = permissionCatalogFor(module);
  const named = (permission) =>
    typeof permission === 'string' && Object.hasOwn(catalog, permission);
  const valid = (permission) =>
    permission === null ||
    named(permission) ||
    (Array.isArray(permission) &&
      permission.length > 0 &&
      permission.length <= 8 &&
      new Set(permission).size === permission.length &&
      permission.every(named));
  for (const action of Object.values(actions))
    assert(
      Object.hasOwn(action, 'permission') && valid(action.permission),
      'Each module action needs an explicit permission.',
    );
  const reserved = {
    backup: 'backups.create',
    'verify-backup': 'backups.create',
    'cleanup-backups': 'backups.cleanup',
    'mod-library-install': 'mods.manage',
    'mod-library-recover': 'mods.manage',
  };
  for (const [action, permission] of Object.entries(reserved))
    assert(
      !Object.hasOwn(actions, action) ||
        actions[action].permission === permission ||
        (Array.isArray(actions[action].permission) &&
          actions[action].permission.includes(permission)),
      'Modules cannot override core action permissions.',
    );
  for (const [route, methods] of Object.entries(policy.routes)) {
    assert(
      Object.hasOwn(routes, route) &&
        !Object.hasOwn(sharedControllerEndpoints, route) &&
        object(methods),
      'Module permission route is outside its contract.',
    );
    assert(
      Object.keys(methods).length > 0 &&
        Object.entries(methods).every(
          ([method, permission]) =>
            Object.hasOwn(routes[route], method) && valid(permission),
        ),
      'Invalid module route permission.',
    );
  }
  for (const [route, methods] of Object.entries(routes))
    if (!Object.hasOwn(sharedControllerEndpoints, route))
      assert(
        Object.keys(methods).every((method) =>
          Object.hasOwn(policy.routes[route] || {}, method),
        ),
        'Each module endpoint needs an explicit permission.',
      );
  assert(
    Array.isArray(screens) &&
      screens.length > 0 &&
      screens.length <= 64 &&
      new Set(screens.map((screen) => screen.id)).size === screens.length,
    'Invalid module screens.',
  );
  for (const screen of screens) {
    assert(
      object(screen) &&
        /^[a-z][a-z0-9-]*$/.test(screen.id) &&
        typeof screen.label === 'string' &&
        screen.label.length > 0 &&
        screen.label.length <= 100,
      'Invalid module screen.',
    );
    for (const key of ['adminOnly', 'ownerOnly'])
      assert(
        screen[key] === undefined || typeof screen[key] === 'boolean',
        'Invalid screen access flag.',
      );
    assert(
      screen.permission === undefined ||
        screen.permission === 'account.self' ||
        named(screen.permission),
      'Invalid screen permission.',
    );
    assert(
      screen.permissionsAny === undefined ||
        (Array.isArray(screen.permissionsAny) &&
          screen.permissionsAny.length > 0 &&
          screen.permissionsAny.every(named)),
      'Invalid screen permission list.',
    );
    assert(
      screen.feature === undefined ||
        contract.features[screen.feature] === true,
      'Screen requires an unavailable feature.',
    );
    assert(
      screen.actions === undefined ||
        (Array.isArray(screen.actions) &&
          screen.actions.every((action) => Object.hasOwn(actions, action))),
      'Screen references an undeclared action.',
    );
  }
}
