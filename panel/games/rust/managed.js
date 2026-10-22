import fs from 'node:fs/promises';
import path from 'node:path';
import {assert, writeJSON} from '../../common.js';
import {ownedImages, snapshotImageCompatible} from '../../core/game-images.js';
import {ensureOwnedImage} from '../../core/image-migration.js';
import {collectSnapshot, restoreSnapshot} from './snapshots.js';

export const managed = {
  version: 1,
  catalog: {
    version: 'Steam public branch',
    image: ownedImages.rust,
    cpu: 4,
    memoryGiB: 12,
    gamePort: 28015,
    queryPort: 28017,
    creation: {
      minMemoryGiB: 8,
      maxMemoryGiB: 32,
      maxPlayers: 1000,
      defaultPlayers: 20,
      fields: [
        {
          key: 'worldSize',
          label: 'Rust world size',
          control: 'range',
          lockOnClone: true,
          min: 1000,
          max: 6000,
          step: 100,
          default: 2000,
        },
      ],
      help: 'The first installation downloads the Rust server and can take several minutes.',
    },
    snapshotHelp:
      'Rust will save, stop briefly, copy its complete identity and resume if running. Players will disconnect.',
  },
  dataTarget: '/steamcmd/rust',
  backupDirectory: 'archives',
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
  ports: [
    {key: 'gamePort', containerPort: 28015, protocol: 'udp', offset: 0},
    {key: 'queryPort', containerPort: 28017, protocol: 'udp', offset: 2},
  ],
  ensureImage: (docker, image) => ensureOwnedImage(docker, 'rust', image),
  creationFromSnapshot(input, manifest) {
    assert(
      Number.isInteger(manifest.seed) && Number.isInteger(manifest.worldSize),
      'Rust snapshot is missing its map identity.',
    );
    return {...input, seed: manifest.seed, worldSize: manifest.worldSize};
  },
  gameEnvironment: (item) => ({
    RUST_SERVER_IDENTITY: 'lobby-goblin-rust',
    RUST_RCON_PASSWORD: item.rconPassword,
    RUST_RCON_PORT: '28016',
    RUST_SERVER_PORT: '28015',
    RUST_SERVER_QUERYPORT: '28017',
    RUST_SERVER_LEVEL: 'Procedural Map',
    RUST_SERVER_WORLDSIZE: String(item.worldSize),
    RUST_SERVER_SEED: String(item.seed),
  }),
  controllerEnvironment: (item, {address}) => ({
    RUST_INSTANCE_ID: item.id,
    RUST_CONTAINER: item.container,
    RUST_IMAGE: item.image,
    RUST_HOST_DATA: '/managed/' + item.id,
    RUST_DATA: '/instance/data/server',
    RUST_INSTALL_ROOT: '/instance/data',
    RUST_STATE_DIR: '/instance/state',
    RUST_BACKUPS_DIR: '/instance/backups',
    RUST_RCON_PASSWORD_FILE: '/instance/control/rcon-password',
    RUST_GAME_ADDRESS: `${address}:${item.gamePort}`,
  }),
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
    includesPlayerData: true,
    compatible: (from, to) => snapshotImageCompatible('rust', from, to),
    collect: collectSnapshot,
    restore: restoreSnapshot,
  },
};
