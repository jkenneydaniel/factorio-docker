import fs from 'node:fs/promises';
import path from 'node:path';
import {assert, writeJSON} from '../../common.js';
import {snapshotImageCompatible} from '../../core/game-images.js';
import {compileManagedDefinition} from '../../core/managed-definition.js';
import {definition} from './definition.js';
import {collectSnapshot, restoreSnapshot} from './snapshots.js';

export const managed = compileManagedDefinition(definition,{
  legacyMigration: {
    file: (config) => path.join(config.state, 'image-migration.json'),
    names: (config, env) => ({
      game: config.container,
      controller:
        env.CONTROLLER_CONTAINER ||
        'lobby-goblin-rust-controller-' + config.instance,
      panel:
        env.PANEL_CONTAINER || 'lobby-goblin-rust-panel-' + config.instance,
    }),
  },
  creationFromSnapshot(input, manifest) {
    assert(
      Number.isInteger(manifest.seed) && Number.isInteger(manifest.worldSize),
      'Rust snapshot is missing its map identity.',
    );
    return {...input, seed: manifest.seed, worldSize: manifest.worldSize};
  },
  async prepareStorage({data}) {
    await fs.mkdir(path.join(data, 'server/lobby-goblin-rust/cfg'), {
      recursive: true,
    });
  },
  async configureStorage({instance, data, config}) {
    await fs.writeFile(
      path.join(instance, 'control/rcon-password'),
      config.rconPassword,
      {mode: 0o600, flag: 'wx'},
    );
    await fs.writeFile(
      path.join(data, 'server/lobby-goblin-rust/cfg/server.cfg'),
      `server.hostname "${config.name}"\nserver.description "Managed by Lobby Goblin"\nserver.maxplayers ${config.maxPlayers}\nserver.saveinterval 600\n`,
      {mode: 0o600},
    );
    for (const directory of ['data/server', 'state', 'backups'])
      await writeJSON(
        path.join(instance, directory, '.lobby-goblin-rust.json'),
        {game: 'rust', instance: config.id},
      );
  },
  snapshots: {
    compatible: (from, to) => snapshotImageCompatible('rust', from, to),
    collect: collectSnapshot,
    restore: restoreSnapshot,
  },
});
