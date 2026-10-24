import {makeZip} from '../core/archive.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  RuntimeUpdates,
  headlessSelection,
  restoreRuntimeBackup,
} from '../applications/factorio/runtime-update.js';
import {
  runtimeHelper,
  runtimeImagePolicy,
  runtimeSoftware,
  runtimeIdentity,
  releaseKey,
} from '../applications/factorio/runtime.js';
import {helperWorkspace} from '../core/helper-workspace.js';
import {ownedDocker} from '../core/owned-docker.js';
import {validateManagedCreation, gameCatalog} from '../core/managed-game.js';
import {ownedImage} from '../core/game-images.js';
import {factorio} from '../applications/factorio/index.js';
import {readJSON, writeJSON} from '../common.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'factorio-runtime-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const data = path.join(root, 'data'),
    state = path.join(root, 'state');
  for (const directory of [
    state,
    path.join(data, 'mods'),
    path.join(data, 'runtime'),
  ])
    await fs.mkdir(directory, {recursive: true});
  const receipt = {
    version: 1,
    provider: 'factorio-headless',
    softwareVersion: '2.0.77',
    sha256: 'a'.repeat(64),
    files: [],
  };
  const release = path.join(data, 'runtime/releases', releaseKey(receipt));
  for (const [name, bytes] of Object.entries({
    'bin/x64/factorio': 'binary sentinel',
    'data/map-settings.example.json': '{}',
  })) {
    await fs.mkdir(path.dirname(path.join(release, name)), {recursive: true});
    await fs.writeFile(path.join(release, name), bytes);
    receipt.files.push({
      name,
      size: Buffer.byteLength(bytes),
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    });
  }
  await writeJSON(path.join(data, 'runtime/installed.json'), receipt);
  const server = {
    Image: 'sha256:' + 'e'.repeat(64),
    Config: {
      Image: runtimeImagePolicy.defaultImage,
      Labels: {'io.lobby-goblin.software-delivery': 'runtime'},
    },
    State: {Running: true, ExitCode: 0, OOMKilled: false},
    Mounts: [{Type: 'bind', Source: data, Destination: '/factorio'}],
  };
  const calls = [];
  const docker = async (method, route, body) => {
    calls.push({method, route, body});
    if (route.endsWith('/json'))
      return {Mounts: [{Type: 'bind', Source: state, Destination: state}]};
    return {};
  };
  return {root, data, state, receipt, release, server, calls, docker};
}

test('new runtime servers are explicit opt-in; bundled defaults and historical image recognition stay compatible', () => {
  const base = {game: 'factorio', name: 'New test server'};
  assert.equal(validateManagedCreation(base, factorio).softwareMode, undefined);
  assert.equal(
    validateManagedCreation({...base, softwareMode: 'runtime'}, factorio)
      .softwareMode,
    'runtime',
  );
  assert.throws(() =>
    validateManagedCreation({...base, softwareMode: 'arbitrary'}, factorio),
  );
  assert.ok(gameCatalog(factorio).softwareModes.includes('runtime'));
  assert.match(factorio.managed.catalog.image, /:2\.0\.77-fc\.3$/);
  assert.equal(
    ownedImage('factorio', runtimeImagePolicy.defaultImage),
    true,
    'Runtime installs must not trigger legacy migration',
  );
  assert.equal(runtimeSoftware.updates, 'manual');
});

test('preview software is copied with verified bytes into private scratch and mounted read-only without exposing data', async (t) => {
  const f = await fixture(t),
    workspace = await helperWorkspace(f, crypto.randomUUID());
  const result = await runtimeHelper(workspace, f);
  assert.equal(result.mounts.length, 2);
  assert.equal(result.mounts[1].ReadOnly, true);
  assert.equal(result.mounts[1].Target, '/opt/factorio');
  assert.equal(
    await fs.realpath(result.mounts[1].Source),
    workspace.work + '/engine',
  );
  assert.ok(result.mounts.every((mount) => !mount.Source.startsWith(f.data)));
  assert.equal(
    await fs.readFile(
      path.join(workspace.work, 'engine/bin/x64/factorio'),
      'utf8',
    ),
    'binary sentinel',
  );
  const before = await runtimeIdentity(f.data, f.server);
  await writeJSON(path.join(f.data, 'runtime/installed.json'), {
    ...f.receipt,
    softwareVersion: '2.0.78',
  });
  assert.notEqual(
    await runtimeIdentity(f.data, f.server),
    before,
    'Same wrapper image cannot reuse previews from another release',
  );
  await workspace.remove();
});

test('preview copying refuses tampered binaries and symlinks into controller-private files', async (t) => {
  const f = await fixture(t),
    file = path.join(f.release, 'bin/x64/factorio');
  let workspace = await helperWorkspace(f, crypto.randomUUID());
  await fs.writeFile(file, 'changed');
  await assert.rejects(runtimeHelper(workspace, f), /files changed/);
  await workspace.remove();
  await fs.unlink(file);
  await fs.symlink(path.join(f.state, 'secret'), file);
  await fs.writeFile(path.join(f.state, 'secret'), 'private sentinel');
  workspace = await helperWorkspace(f, crypto.randomUUID());
  await assert.rejects(runtimeHelper(workspace, f));
  await workspace.remove();
  assert.equal(
    await fs.readFile(path.join(f.state, 'secret'), 'utf8'),
    'private sentinel',
  );
});

test('broker admits only a read-only software overlay inside the same private helper workspace', async () => {
  const fleet = 'a'.repeat(32),
    id = 'b'.repeat(32),
    volume = 'lobby-goblin-' + fleet + '-' + id,
    container = volume + '-factorio';
  const labels = {
    'io.lobby-goblin.fleet': fleet,
    'io.lobby-goblin.instance': id,
  };
  const owner = {
    Id: 'server',
    Name: '/' + container,
    Image: 'image',
    Config: {Image: 'image', Labels: labels},
    Mounts: [{Type: 'volume', Name: volume, Destination: '/factorio'}],
    HostConfig: {
      Mounts: [
        {
          Type: 'volume',
          Source: volume,
          Target: '/factorio',
          VolumeOptions: {Subpath: 'data'},
        },
      ],
    },
  };
  const calls = [],
    request = async (method, route, body) => {
      calls.push({method, route, body});
      return route.endsWith('/json') ? owner : {};
    };
  const docker = ownedDocker(
    request,
    {FLEET_ID: fleet, FLEET_INSTANCE: id, FLEET_VOLUME: volume},
    {container, ...factorio.managed},
  );
  const mount = {
    Type: 'volume',
    Source: volume,
    Target: '/factorio',
    VolumeOptions: {
      Subpath: 'state/.panel-work/preview-' + crypto.randomUUID(),
      NoCopy: true,
    },
  };
  const body = {
    Image: 'image',
    Entrypoint: ['/opt/factorio/bin/x64/factorio'],
    HostConfig: {
      NetworkMode: 'none',
      Memory: 1024 ** 3,
      Mounts: [
        mount,
        {
          ...mount,
          Target: '/opt/factorio',
          ReadOnly: true,
          VolumeOptions: {
            Subpath: mount.VolumeOptions.Subpath + '/engine',
            NoCopy: true,
          },
        },
      ],
    },
  };
  await docker('POST', '/containers/create', structuredClone(body));
  for (const change of [
    (value) => (value.ReadOnly = false),
    (value) => (value.Source = 'another-volume'),
    (value) => (value.VolumeOptions.Subpath = 'data/runtime'),
    (value) => (value.Target = '/instance/control'),
  ]) {
    const hostile = structuredClone(body);
    change(hostile.HostConfig.Mounts[1]);
    await assert.rejects(docker('POST', '/containers/create', hostile));
  }
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
});

async function updater(t, {failure = false, running = true} = {}) {
  const f = await fixture(t);
  f.server.State.Running = running;
  const wanted = {
      ...f.receipt,
      softwareVersion: '2.0.78',
      sha256: 'b'.repeat(64),
    },
    events = [];
  const instance = new RuntimeUpdates({
    data: f.data,
    state: f.state,
    info: async () => f.server,
    stage: async (job, message, phase) => events.push(phase),
    select: async () => wanted,
    control: async (action) => {
      events.push(action);
      f.server.State.Running = action === 'start';
      if (action === 'start') {
        const request = await readJSON(
          path.join(f.data, 'runtime/request.json'),
          null,
        );
        if (request) {
          await writeJSON(path.join(f.data, 'runtime/installed.json'), {
            ...wanted,
            operation: request.operation,
          });
          await fs.rm(path.join(f.data, 'runtime/request.json'));
        }
      }
    },
    backup: async () => {
      events.push('backup');
      return 'before-software-update.zip';
    },
    ready: async (version) => {
      events.push('ready:' + version);
      if (failure && version === wanted.softwareVersion)
        throw Error('new release cannot load this synthetic world');
    },
    restore: async (name, receipt) => {
      events.push('restore:' + name);
      assert.equal(receipt.softwareVersion, f.receipt.softwareVersion);
    },
  });
  return {...f, instance, wanted, events};
}

test('runtime upgrade backs up stopped data before activation and preserves previous running or stopped state', async (t) => {
  for (const running of [true, false]) {
    const f = await updater(t, {running});
    await f.instance.update(
      {version: '2.0.78', confirm: true},
      {id: crypto.randomUUID()},
    );
    assert.ok(f.events.indexOf('backup') < f.events.indexOf('start'));
    assert.equal(f.server.State.Running, running);
    assert.equal((await f.instance.journal()).phase, 'complete');
    assert.equal(
      (await readJSON(path.join(f.data, 'runtime/installed.json')))
        .softwareVersion,
      '2.0.78',
    );
  }
});

test('failed or interrupted upgrades block mutation and explicit recovery pairs prior software with its data', async (t) => {
  const f = await updater(t, {failure: true});
  await assert.rejects(
    f.instance.update(
      {version: '2.0.78', confirm: true},
      {id: crypto.randomUUID()},
    ),
    /needs recovery/,
  );
  assert.equal(f.server.State.Running, false);
  await assert.rejects(f.instance.guard('start'), /needs recovery/);
  await assert.rejects(f.instance.guard('restore'), /needs recovery/);
  const restarted = new RuntimeUpdates({...f.instance});
  assert.equal((await restarted.pending()).phase, 'recovery-required');
  await restarted.recover({confirm: true}, {id: crypto.randomUUID()});
  assert.ok(
    f.events.indexOf('restore:before-software-update.zip') <
      f.events.indexOf('ready:2.0.77'),
  );
  assert.equal(
    (await readJSON(path.join(f.data, 'runtime/installed.json')))
      .softwareVersion,
    '2.0.77',
  );
  assert.equal(f.server.State.Running, true);
  assert.equal(await restarted.pending(), null);
});

test('official checksum selection rejects wrong names, duplicate hashes, HTML and missing releases', async () => {
  const fetcher = (text) => async () =>
    new Response(text, {headers: {'content-type': 'text/plain'}});
  const checksum = 'a'.repeat(64);
  assert.equal(
    (
      await headlessSelection(
        '2.0.77',
        fetcher(checksum + '  factorio-headless_linux_2.0.77.tar.xz'),
      )
    ).sha256,
    checksum,
  );
  for (const body of [
    checksum + '  factorio_linux_2.0.77.tar.xz',
    '<html>oops</html>',
    (checksum + '  factorio-headless_linux_2.0.77.tar.xz\n').repeat(2),
  ])
    await assert.rejects(headlessSelection('2.0.77', fetcher(body)));
  await assert.rejects(headlessSelection('../../escape', fetcher('')));
});

test('paired data recovery resumes after a directory move was interrupted and refuses linked destinations', async (t) => {
  const f = await fixture(t),
    backups = path.join(f.root, 'backups'),
    backupDir = path.join(backups, 'panel-backups');
  await fs.mkdir(backupDir, {recursive: true});
  await fs.mkdir(path.join(f.data, 'saves'));
  await fs.writeFile(
    path.join(f.data, 'saves', 'current.zip'),
    'displaced current world',
  );
  const world = makeZip([
    {name: 'world/level.dat', data: Buffer.from('synthetic restored world')},
  ]);
  const archive = makeZip([
    {name: 'saves/world.zip', data: world},
    {name: 'config/server-settings.json', data: Buffer.from('{}')},
    {name: 'mods/mod-list.json', data: Buffer.from('{}')},
    {
      name: 'panel-manifest.json',
      data: Buffer.from(
        JSON.stringify({activeSave: 'world.zip', software: f.receipt}),
      ),
    },
  ]);
  await fs.writeFile(path.join(backupDir, 'paired.zip'), archive);
  // CONFIG is missing, as after a kill between moving it and recreating it.
  await restoreRuntimeBackup({
    data: f.data,
    backups,
    backupDir,
    name: 'paired.zip',
    previous: f.receipt,
  });
  assert.deepEqual(
    await fs.readFile(path.join(f.data, 'saves/world.zip')),
    world,
  );
  assert.equal(
    await fs.readFile(path.join(f.data, 'config/server-settings.json'), 'utf8'),
    '{}',
  );
  const preserved = (await fs.readdir(backups)).find((name) =>
    name.startsWith('before-software-recovery-'),
  );
  assert.equal(
    await fs.readFile(
      path.join(backups, preserved, 'saves/current.zip'),
      'utf8',
    ),
    'displaced current world',
  );
  await fs.rm(path.join(f.data, 'config'), {recursive: true});
  await fs.symlink(f.state, path.join(f.data, 'config'));
  await fs.writeFile(path.join(f.state, 'sentinel'), 'private');
  await assert.rejects(
    restoreRuntimeBackup({
      data: f.data,
      backups,
      backupDir,
      name: 'paired.zip',
      previous: f.receipt,
    }),
    /ordinary directories/,
  );
  assert.equal(
    await fs.readFile(path.join(f.state, 'sentinel'), 'utf8'),
    'private',
  );
  assert.deepEqual(
    await fs.readFile(path.join(f.data, 'saves/world.zip')),
    world,
  );
});
