import {assert} from '../common.js';
import {sharedControllerEndpoints} from './routes.js';

export const coreActions = ['backup', 'verify-backup', 'cleanup-backups'];
export const action = (label, confirmation = false, retry = 'manual', permission = null) => ({
  label,
  confirmation,
  retry,
  permission,
});
export const backupActions = (interruption = false) => ({
  backup: action('Create backup', interruption, 'manual', 'backups.create'),
  'verify-backup': action('Verify backup', false, 'manual', 'backups.create'),
  'cleanup-backups': action('Clean up reviewed backups', true, 'manual', 'backups.cleanup'),
});
export const modActions = {
  'mod-library-install': action('Apply reviewed mod changes', true, 'manual', 'mods.manage'),
  'mod-library-recover': action('Recover interrupted mod changes', true, 'manual', 'mods.manage'),
};
export const modRoutes = {
  '/mod-library': {GET: 'admin'},
  '/mod-library-plan': {POST: 'admin'},
  '/mod-library-account': {POST: 'admin'},
};
const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value);
const functions = (value, keys, owner) => {
  assert(object(value), `${owner} must be an object.`);
  for (const key of keys)
    assert(typeof value[key] === 'function', `${owner} needs ${key}.`);
};

// Contract metadata is trusted built-in code, never supplied by an HTTP request.
export function validateContract(contract) {
  assert([1,2].includes(contract?.version), 'Unsupported game-module contract.');
  assert(
    object(contract.features) &&
      Object.values(contract.features).every(
        (value) => typeof value === 'boolean',
      ),
    'Invalid module capabilities.',
  );
  assert(
    object(contract.actions) && object(contract.routes),
    'Module needs action and route contracts.',
  );
  for (const [name, policy] of Object.entries(contract.actions)) {
    assert(
      /^[a-z][a-z0-9-]*$/.test(name) &&
        object(policy) &&
        typeof policy.label === 'string' &&
        policy.label.length > 0 &&
        typeof policy.confirmation === 'boolean' &&
        ['manual', 'convergent'].includes(policy.retry),
      'Invalid action contract.',
    );
    assert(
      policy.retry !== 'convergent' || ['start', 'stop'].includes(name),
      'Only start and stop support convergent recovery retries.',
    );
  }
  for (const [route, methods] of Object.entries(contract.routes)) {
    assert(route!=='/management'&&!route.startsWith('/management/'),'Management maintenance endpoints are private to the local operator.');
    if(Object.hasOwn(sharedControllerEndpoints,route))assert(Object.entries(methods).every(([method,role])=>Object.hasOwn(sharedControllerEndpoints[route],method)&&(sharedControllerEndpoints[route][method]!=='admin'||role==='admin')),'Modules cannot override shared endpoint permissions.');
    assert(
      /^\/[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/.test(route) &&
        object(methods) &&
        Object.keys(methods).length > 0,
      'Invalid route contract.',
    );
    for (const [method, role] of Object.entries(methods))
      assert(
        ['GET', 'POST'].includes(method) &&
          ['viewer', 'admin'].includes(role) &&
          (method !== 'POST' || role === 'admin'),
        'Invalid route permission contract.',
      );
  }
  const backup = contract.backup;
  assert(
    object(backup) &&
      ['files', 'stream'].includes(backup.strategy) &&
      /^\.[a-z0-9.]{1,20}$/.test(backup.extension) &&
      typeof backup.mediaType === 'string' &&
      /^[a-z-]+\/[a-z0-9.+-]+$/.test(backup.mediaType) &&
      typeof backup.interruption === 'boolean',
    'Invalid backup contract.',
  );
  for (const name of coreActions)
    assert(
      Object.hasOwn(contract.actions, name),
      'Module must declare shared backup actions.',
    );
  assert(
    contract.actions.backup.confirmation === backup.interruption,
    'Backup interruption policy must match its action contract.',
  );
  assert(
    contract.actions['cleanup-backups'].confirmation === true,
    'Backup cleanup requires confirmation.',
  );
  return contract;
}

export function validateConfiguration(config) {
  assert(object(config), 'Game configuration must be an object.');
  for (const key of ['state', 'library', 'backupDir', 'container'])
    assert(
      typeof config[key] === 'string' && config[key].length > 0,
      `Game configuration needs ${key}.`,
    );
  return config;
}

export function validateController(module, game) {
  functions(
    game,
    [
      'status',
      'handle',
      'validateAction',
      'init',
      'start',
      'beforeJob',
      'afterJob',
      'waitIdle',
      'invalidate',
      'recentStatus',
      'backupVerified',
    ],
    'Game controller',
  );
  assert(object(game.actions), 'Game controller needs actions.');
  assert(game.operationSources===undefined||Array.isArray(game.operationSources),'Invalid operation source adapters.');
  assert(game.inspectOperation===undefined||typeof game.inspectOperation==='function','Invalid operation inspection adapter.');
  const expected = Object.keys(module.contract.actions)
    .filter((name) => !coreActions.includes(name))
    .sort();
  assert(
    JSON.stringify(Object.keys(game.actions).sort()) ===
      JSON.stringify(expected),
    'Controller actions do not match the module contract.',
  );
  functions(game.actions, expected, 'Controller actions');
  assert(
    Array.isArray(game.locations) &&
      game.locations.every(
        (value) =>
          object(value) &&
          ['id', 'title', 'path'].every(
            (key) => typeof value[key] === 'string',
          ),
      ),
    'Game controller needs diagnostic locations.',
  );
  const backup = module.contract.backup;
  functions(
    game,
    backup.strategy === 'files'
      ? ['backupFiles', 'validateBackup']
      : ['writeBackup', 'verifyBackupFile'],
    'Game backup adapter',
  );
  assert(
    game.backupExtension === undefined ||
      game.backupExtension === backup.extension,
    'Controller backup format differs from its contract.',
  );
  game.backupExtension = backup.extension;
  return game;
}

export function validateUpdater(updater) {
  assert(updater.operationSource===undefined||typeof updater.operationSource==='function','Invalid update operation source.');
  functions(
    updater,
    ['init', 'refresh', 'status', 'plan', 'install', 'restored'],
    'Game updater',
  );
  assert(
    typeof updater.current === 'string' &&
      Array.isArray(updater.jobs) &&
      typeof updater.busy === 'boolean',
    'Invalid updater state contract.',
  );
  return updater;
}

export function validateActionRequest(module, body) {
  assert(
    object(body) &&
      typeof body.action === 'string' &&
      Object.hasOwn(module.contract.actions, body.action),
    'Unsupported action.',
  );
  assert(
    body.params === undefined || object(body.params),
    'Action parameters must be an object.',
  );
  if (module.contract.actions[body.action].confirmation)
    assert(body.params?.confirm === true, 'This action requires confirmation.');
  return body;
}

export function publicContract(module) {
  return {
    version: module.contract.version,
    id: module.id,
    name: module.name,
    features: module.contract.features,
    actions: module.contract.actions,
    backup: module.contract.backup,
    routes: module.contract.routes,
    screens: module.contract.screens,
    policy: module.contract.policy,
    ...(module.presentation ? {presentation: module.presentation} : {}),
    ...(module.application ? {application: module.application} : {}),
  };
}

// The summary is additive. Factorio's players array and Rust's numeric players
// remain unchanged for installed panels and integrations using legacy fields.
export function normalizeStatus(module, value) {
  assert(
    object(value) && typeof value.ready === 'boolean',
    'Invalid game readiness response.',
    502,
  );
  assert(
    value.running === undefined || typeof value.running === 'boolean',
    'Invalid game running response.',
    502,
  );
  assert(
    !value.ready || value.running !== false,
    'A stopped game cannot report ready.',
    502,
  );
  assert(
    value.players == null ||
      Array.isArray(value.players) ||
      (Number.isInteger(value.players) && value.players >= 0),
    'Invalid game player response.',
    502,
  );
  const running = value.running ?? (value.ready ? true : null),
    online = Array.isArray(value.players)
      ? value.players.length
      : (value.players ?? null);
  return {
    ...value,
    game: module.id,
    statusVersion: 1,
    summary: {
      running,
      ready: value.ready,
      paused: value.paused === true,
      state: value.ready
        ? value.paused
          ? 'paused'
          : 'ready'
        : running
          ? 'starting'
          : running === false
            ? 'stopped'
            : 'unavailable',
      name: typeof value.name === 'string' ? value.name : null,
      connection:
        typeof value.connection === 'string' ? value.connection : null,
      players: {
        online,
        limit:
          Number.isInteger(value.maxPlayers) && value.maxPlayers >= 0
            ? value.maxPlayers
            : null,
      },
    },
  };
}
