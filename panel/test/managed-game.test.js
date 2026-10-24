import test from 'node:test';
import assert from 'node:assert/strict';
import {registeredApplications} from '../applications/index.js';
import {
  gameCatalog,
  validateManagedGame,
  validateManagedCreation,
} from '../core/managed-game.js';
import {safeSnapshotPath} from '../core/snapshot-files.js';
import {controllerRoutes, sharedControllerRoutes} from '../core/routes.js';

for (const module of registeredApplications())
  test(`${module.name} implements the managed-game contract without changing legacy defaults`, () => {
    const managed = validateManagedGame(module),
      catalog = gameCatalog(module);
    assert.equal(catalog.id, module.id);
    assert.equal(catalog.image, managed.catalog.image);
    const creation = validateManagedCreation(
      {game: module.id, name: 'Fixture'},
      module,
    );
    assert.equal(creation.memoryGiB, catalog.memoryGiB);
    assert.equal(creation.maxPlayers, catalog.creation.defaultPlayers);
    assert.equal(
      catalog.gamePort,
      managed.ports.find((port) => port.key === 'gamePort').containerPort,
    );
    for (const route of sharedControllerRoutes)
      assert.ok(controllerRoutes(module).includes(route));
    assert.equal(
      new Set(controllerRoutes(module)).size,
      controllerRoutes(module).length,
    );
    assert.throws(
      () =>
        validateManagedGame({...module, managed: {...managed, version: 99}}),
      /contract/,
    );
    assert.throws(
      () =>
        validateManagedGame({
          ...module,
          managed: {...managed, configureStorage: undefined},
        }),
      /configureStorage/,
    );
    assert.throws(
      () =>
        validateManagedGame({
          ...module,
          managed: {...managed, catalog: {...catalog, cpu: 0}},
        }),
      /defaults/,
    );
  });

test('shared snapshot paths refuse platform separators and traversal', () => {
  for (const name of [
    '../world',
    'a/../world',
    '/world',
    'a\\world',
    'a//world',
    'a:b',
  ])
    assert.equal(safeSnapshotPath(name), false, name);
  assert.equal(safeSnapshotPath('mods/module.zip'), true);
});
