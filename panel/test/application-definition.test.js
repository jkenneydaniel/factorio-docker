import test from 'node:test';
import assert from 'node:assert/strict';
import {registeredApplications} from '../applications/index.js';
import {definitionData} from '../core/definition-data.js';
import {applicationDefinition} from '../core/application-definition.js';
import {applicationMetadata} from '../core/application-services.js';
import {compileManagedDefinition} from '../core/managed-definition.js';
import {validateApplicationModule} from '../core/application-module.js';
import {
  validateEnvironmentBindings,
  renderEnvironment,
} from '../core/environment-bindings.js';
import {hostDockerPolicy} from '../core/broker-policy.js';
import {arena} from './fixtures/arena-game.js';
import source from './fixtures/arena-definition.json' with {type: 'json'};
import presentation from './fixtures/arena-presentation.json' with {type: 'json'};
const adapter = {
  prepareStorage: async () => {},
  configureStorage: async () => {},
  snapshots: {
    compatible: () => true,
    collect: async () => {},
    restore: async () => {},
  },
};
const compile = (value) =>
  compileManagedDefinition(applicationDefinition(value, presentation), adapter);

test('built-in games share checked immutable runtime declarations and retain their established catalogue and environment ABI', () => {
  const item = {
    id: 'a'.repeat(32),
    container: 'fixture-game',
    image: 'fixture:image',
    rconPassword: 'fixture-private-rcon',
    controllerToken: 'private-controller',
    gamePort: 35000,
    queryPort: 35002,
    worldSize: 2000,
    seed: 12345,
  };
  for (const module of registeredApplications()) {
    assert.ok(
      Object.isFrozen(module.definition) &&
        Object.isFrozen(module.managed) &&
        Object.isFrozen(module.imagePolicy),
    );
    assert.equal(
      module.imagePolicy,
      module.definition.services[0].configuration.imagePolicy,
    );
    assert.equal(module.managed.catalog.image, module.imagePolicy.defaultImage);
    assert.equal(module.application, applicationMetadata(module.definition));
    const wire = JSON.stringify(module.application);
    assert.ok(
      !wire.includes('configuration') &&
        !wire.includes('referencePattern') &&
        !wire.includes('secret'),
    );
    assert.throws(
      () => validateApplicationModule({...module, managed: {...module.managed}}),
      /registered application definition/,
    );
  }
  const factorio = registeredApplications().find((module) => module.id === 'factorio'),
    rust = registeredApplications().find((module) => module.id === 'rust');
  assert.equal(factorio.managed.catalog.gamePort, 34197);
  assert.equal(factorio.managed.catalog.memoryGiB, 2);
  assert.equal(factorio.managed.dataTarget, '/factorio');
  assert.deepEqual(
    factorio.managed.controllerEnvironment(item, {
      address: 'host.example.test',
    }),
    {
      FACTORIO_CONTAINER: 'fixture-game',
      FACTORIO_DATA: '/instance/data',
      BACKUPS_DIR: '/instance/backups',
      FACTORIO_PLATFORM: 'linux/amd64',
      GAME_ADDRESS: 'host.example.test:35000',
    },
  );
  assert.equal(rust.managed.catalog.queryPort, 28017);
  assert.equal(rust.managed.catalog.memoryGiB, 12);
  assert.equal(rust.managed.dataTarget, '/steamcmd/rust');
  assert.equal(
    rust.managed.gameEnvironment(item).RUST_RCON_PASSWORD,
    item.rconPassword,
  );
  assert.equal(rust.managed.gameEnvironment(item).RUST_SERVER_SEED, '12345');
  assert.equal(
    rust.managed.controllerEnvironment(item, {address: 'host.example.test'})
      .RUST_HOST_DATA,
    '/managed/' + item.id,
  );
});

test('definition registration rejects executable objects, accessors, sparse arrays, unsafe keys and undeclared profile fields before runtime work', () => {
  let invoked = false;
  const getter = {};
  Object.defineProperty(getter, 'services', {
    enumerable: true,
    get() {
      invoked = true;
      return [];
    },
  });
  assert.throws(() => definitionData(getter), /Unsafe/);
  assert.equal(invoked, false);
  const presentationGetter = {};
  Object.defineProperty(presentationGetter, 'presentation', {
    enumerable: true,
    get() {
      invoked = true;
      return {};
    },
  });
  assert.throws(() => applicationDefinition(presentationGetter), /Unsafe/);
  assert.equal(invoked, false);
  for (const change of [
    (value) => {
      value.services[0].configuration.shell = 'command';
    },
    (value) => {
      value.services[0].configuration.catalog.creation.defaults = {cpu: 999};
    },
    (value) => {
      value.services[0].configuration.helpers.privileged = true;
    },
    (value) => {
      value.services[0].profile = 'unknown-profile';
    },
    (value) => {
      value.services[0].configuration.environment.controller.NODE_OPTIONS = [
        {literal: '--require /instance/data/unsafe.js'},
      ];
    },
    (value) => {
      value.services[0].configuration.environment.controller.ARENA_DATA = [
        {literal: '/broker/credential'},
      ];
    },
    (value) => {
      value.services[0].configuration.environment.controller.ARENA_DATA = [
        {literal: '../broker/credential'},
      ];
    },
    (value) => {
      value.services[0].configuration.environment.server.ARENA_VALUE = [
        {field: 'controllerToken'},
      ];
    },
  ]) {
    const next = structuredClone(source);
    change(next);
    assert.throws(() => compile(next));
  }
  const executable = structuredClone(source);
  executable.services[0].configuration.run = () => {};
  assert.throws(() => compile(executable), /JSON data/);
  const sparse = Array(2);
  sparse[1] = 1;
  assert.throws(() => definitionData(sparse), /ordinary JSON arrays/);
  assert.throws(() => definitionData(JSON.parse('{"__proto__":{}}')), /Unsafe/);
  assert.throws(
    () => compileManagedDefinition(source, adapter),
    /Register the application/,
  );
});

test('bindings separate private references from instance fields and protect controller scope without limiting workload environment names', () => {
  const bindings = {
    MODE: [{literal: 'workload'}],
    APP_VALUE: [{field: 'name'}],
    APP_KEY: [{secret: 'appKey'}],
  };
  validateEnvironmentBindings(bindings, {secrets: ['appKey']});
  assert.deepEqual(
    renderEnvironment(bindings, {name: 'sample'}, {appKey: 'private-value'}),
    {MODE: 'workload', APP_VALUE: 'sample', APP_KEY: 'private-value'},
  );
  assert.throws(
    () =>
      renderEnvironment(
        {ARENA_DATA: [{field: 'name'}]},
        {name: '../broker/credential/token'},
        {},
        {controller: true},
      ),
    /bounds/,
  );
  assert.throws(
    () => renderEnvironment({ARENA_NAME: [{field: 'missing'}]}, {}),
    /unavailable/,
  );
  for (const key of ['DOCKER_HOST', 'FLEET_ID', 'NODE_OPTIONS', 'MODE', 'PATH'])
    assert.throws(
      () =>
        validateEnvironmentBindings(
          {[key]: [{literal: 'value'}]},
          {controllerPrefix: 'ARENA_'},
        ),
      /management controls/,
    );
  assert.throws(
    () =>
      validateEnvironmentBindings(
        {ARENA_KEY: [{secret: 'appKey'}]},
        {controllerPrefix: 'ARENA_', secrets: ['appKey']},
      ),
    /Unapproved/,
  );
});

test('a new package image revision is admitted through its own declared policy rather than a built-in game branch', async () => {
  const module = arena('/unused-fixture'),
    calls = [],
    fleet = 'a'.repeat(32),
    runtime = 'sha256:' + 'b'.repeat(64);
  const request = hostDockerPolicy(
    async (method, route) => {
      calls.push({method, route});
      return {};
    },
    {
      fleet,
      hostContainer: 'host',
      runtimeImage: runtime,
      transportVolume: 'lobby-goblin-fleet-' + fleet + '-broker-transport',
      modules: [module],
    },
  );
  await request(
    'GET',
    '/images/' + encodeURIComponent('registry.example/arena:1-r2') + '/json',
  );
  assert.equal(calls.length, 1);
  await assert.rejects(
    request(
      'GET',
      '/images/' +
        encodeURIComponent('unreviewed.example/arena:1-r2') +
        '/json',
    ),
    {status: 403},
  );
  assert.equal(calls.length, 1);
});
