import fs from 'node:fs/promises';
import path from 'node:path';
import {writeJSON} from '../../common.js';
import {ownedImages, snapshotImageCompatible} from '../../core/game-images.js';
import {ensureOwnedImage} from '../../core/image-migration.js';
import {collectSnapshot, restoreSnapshot} from './snapshots.js';

export const managed = {
  version: 1,
  catalog: {
    version: '2.0.77',
    image: ownedImages.factorio,
    cpu: 1,
    memoryGiB: 2,
    gamePort: 34197,
    creation: {
      minMemoryGiB: 1,
      maxMemoryGiB: 32,
      maxPlayers: 100,
      defaultPlayers: 10,
      defaults: {worldSize: 2000},
      fields: [],
      help: 'The game version remains compatible with 2.0.77 clients.',
    },
    snapshotHelp:
      'Factorio will save and create a consistent backup. The published snapshot includes the active world and its mods.',
  },
  dataTarget: '/factorio',
  backupDirectory: 'panel-backups',
  legacyMigration: {
    file: (config, env) =>
      path.join(env.UPDATE_STATE_DIR || '/updates', 'image-migration.json'),
    names: (config, env) => ({
      game: config.container,
      controller: env.CONTROLLER_CONTAINER || 'factorio-panel-controller',
      panel: env.PANEL_CONTAINER || 'factorio-panel',
    }),
  },
  ports: [{key: 'gamePort', containerPort: 34197, protocol: 'udp', offset: 0}],
  previewWorker: {target: '/factorio', root: 'data/.panel-work'},
  ensureImage: (docker, image) => ensureOwnedImage(docker, 'factorio', image),
  creationFromSnapshot: (input) => input,
  gameEnvironment: () => ({
    LOAD_LATEST_SAVE: 'true',
    GENERATE_NEW_SAVE: 'false',
    SAVE_NAME: 'world',
    DLC_SPACE_AGE: 'false',
    UPDATE_MODS_ON_START: 'false',
  }),
  controllerEnvironment: (item, {address}) => ({
    FACTORIO_CONTAINER: item.container,
    FACTORIO_DATA: '/instance/data',
    BACKUPS_DIR: '/instance/backups',
    FACTORIO_PLATFORM: 'linux/amd64',
    GAME_ADDRESS: `${address}:${item.gamePort}`,
  }),
  async prepareStorage({instance, data, config}) {
    for (const directory of ['saves', 'config', 'mods'])
      await fs.mkdir(path.join(data, directory), {recursive: true});
    // Snapshot content is restored before new credentials and configuration.
  },
  async configureStorage({data, config}) {
    await writeJSON(path.join(data, 'config/server-settings.json'), {
      name: config.name,
      description: 'Managed by Lobby Goblin',
      visibility: {public: false, lan: true},
      require_user_verification: false,
      max_players: config.maxPlayers,
      autosave_interval: 5,
      autosave_slots: 3,
      auto_pause: true,
    });
    // A fresh boot must not look like an existing identity with a missing world.
    if (config.snapshotId)
      await fs.writeFile(
        path.join(data, 'config/rconpw'),
        config.rconPassword,
        {mode: 0o600, flag: 'wx'},
      );
    else
      await writeJSON(path.join(data, 'config/map-gen-settings.json'), {
        seed: config.seed,
      });
  },
  snapshots: {
    includesPlayerData: false,
    compatible: (from, to) => snapshotImageCompatible('factorio', from, to),
    collect: collectSnapshot,
    restore: restoreSnapshot,
  },
};
