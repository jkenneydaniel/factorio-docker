// Opt-in real Linux mount/cleanup acceptance. All files and containers belong
// to a fresh synthetic fixture on an explicitly marked disposable engine.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {docker} from '../core/docker.js';
import {helperWorkspace} from '../core/helper-workspace.js';
import {
  renderWorldPreview,
  cleanPreviewWorkers,
} from '../applications/factorio/world-preview.js';

const owner = '01a16598-733c-7232-bd99-1d6b06086183';
assert.equal(
  (await fs.readFile('/acceptance-owner', 'utf8')).trim(),
  owner + ' disposable platform acceptance only',
);
assert.equal(process.env.DOCKER_SOCKET, '/var/run/docker.sock');
assert.equal(
  (await docker('GET', '/info')).ID,
  process.env.ACCEPTANCE_ENGINE_ID,
);
const runner = process.env.ACCEPTANCE_RUNNER,
  image = process.env.ACCEPTANCE_HELPER_IMAGE;
assert.match(runner || '', /^lobby-acceptance-helper-[a-f0-9]{32}$/);
assert.match(image || '', /^sha256:[a-f0-9]{64}$/);
const self = await docker('GET', '/containers/' + runner + '/json');
assert.equal(self.Config.Labels['io.lobby-goblin.acceptance'], owner);
const dataVolume = self.Mounts.find(
  (m) => m.Destination === '/fixture/data',
)?.Name;
const privateVolume = self.Mounts.find(
  (m) => m.Destination === '/fixture/private',
)?.Name;
assert.ok(dataVolume && privateVolume && dataVolume !== privateVolume);
assert.ok(
  [dataVolume, privateVolume].every((value) => value.startsWith(runner + '-')),
);
const data = '/fixture/data',
  state = '/fixture/private/state',
  control = '/fixture/private/control';
for (const dir of [
  state,
  control,
  path.join(data, 'mods/unpacked/prototypes'),
  path.join(data, 'saves'),
])
  await fs.mkdir(dir, {recursive: true, mode: 0o700});
await fs.writeFile(path.join(control, 'sentinel'), 'private control fixture');
await fs.writeFile(
  path.join(data, 'saves/world.zip'),
  'preserved world fixture',
);
await fs.writeFile(
  path.join(data, 'mods/unpacked/prototypes/item.lua'),
  'nested fixture',
);
const options = {
  data,
  state,
  env: {CONTROLLER_CONTAINER: runner},
  server: {
    Image: image,
    Mounts: [{Type: 'volume', Name: dataVolume, Destination: '/factorio'}],
    HostConfig: {
      Mounts: [{Type: 'volume', Source: dataVolume, Target: '/factorio'}],
    },
  },
  docker,
};
const before = await Promise.all([
  fs.readFile(path.join(control, 'sentinel')),
  fs.readFile(path.join(data, 'saves/world.zip')),
]);

// Real orphaned pre-fix helper mounts must be revoked before private cleanup.
const old = [];
for (const family of ['preview', 'map', 'job']) {
  const id = crypto.randomUUID(),
    child = (family === 'preview' ? 'preview-' : '') + id;
  const workspace = await helperWorkspace(options, child);
  const legacy = path.join(data, '.panel-work', child);
  await fs.mkdir(legacy, {recursive: true});
  await fs.writeFile(path.join(legacy, 'retained'), 'legacy bytes');
  const name = 'factorio-panel-' + family + '-' + id;
  const created = await docker(
    'POST',
    '/containers/create?' + new URLSearchParams({name}),
    {
      Image: image,
      User: '0:0',
      Entrypoint: ['node'],
      Cmd: ['-e', 'setInterval(()=>{},1000)'],
      Labels:
        family === 'preview'
          ? {'factorio-panel.preview': 'true', 'factorio-panel.preview-id': id}
          : {'factorio-panel.job': id},
      HostConfig: {
        NetworkMode: 'none',
        CapDrop: ['ALL'],
        Mounts: [
          {
            Type: 'volume',
            Source: dataVolume,
            Target: '/factorio',
            VolumeOptions: {Subpath: '.panel-work/' + child},
          },
        ],
      },
    },
  );
  await docker('POST', '/containers/' + created.Id + '/start');
  old.push({id: created.Id, work: workspace.work, legacy});
}
await cleanPreviewWorkers(state, options);
for (const item of old) {
  await assert.rejects(
    docker('GET', '/containers/' + item.id + '/json'),
    (error) => error.status === 404,
  );
  await assert.rejects(fs.access(item.work), {code: 'ENOENT'});
  assert.equal(
    await fs.readFile(path.join(item.legacy, 'retained'), 'utf8'),
    'legacy bytes',
  );
}
// The game-owned location is now hostile; production helpers must ignore it.
await fs.rename(
  path.join(data, '.panel-work'),
  path.join(data, 'retained-legacy-work'),
);
await fs.symlink(control, path.join(data, '.panel-work'));
const png = await renderWorldPreview(
  {configuration: {map_gen_settings: {}}, seed: 42},
  options,
);
assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
await assert.rejects(
  renderWorldPreview(
    {configuration: {map_gen_settings: {}}, seed: 13},
    options,
  ),
  /leaves its storage/,
);
assert.deepEqual(await fs.readdir(path.join(state, '.panel-work')), []);
assert.ok((await fs.lstat(path.join(data, '.panel-work'))).isSymbolicLink());
assert.deepEqual(
  await Promise.all([
    fs.readFile(path.join(control, 'sentinel')),
    fs.readFile(path.join(data, 'saves/world.zip')),
  ]),
  before,
);
await fs.writeFile(
  '/acceptance-output/helper-result.json',
  JSON.stringify(
    {
      engine: process.env.ACCEPTANCE_ENGINE_ID,
      runner,
      removed: old.length,
      nestedInputs: true,
      privateMounts: true,
      hostileOutputRejected: true,
      preserved: true,
      complete: true,
    },
    null,
    2,
  ),
  {mode: 0o600, flag: 'wx'},
);
console.log(
  'Real helper mounts, nested inputs, orphan cleanup and hostile output checks passed; private/world fixture bytes preserved.',
);
