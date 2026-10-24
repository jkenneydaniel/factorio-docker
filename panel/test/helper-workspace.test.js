import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  helperWorkspace,
  readScopedFile,
  removeHelperWorkspace,
} from '../core/helper-workspace.js';
import {
  renderWorldPreview,
  cleanPreviewWorkers,
} from '../applications/factorio/world-preview.js';

test('unpacked mods retain nested prototypes and locale files in every helper workspace', async (t) => {
  const f = await fixture(t),
    nested = 'mods/unpacked/prototypes/items/example.lua';
  await fs.mkdir(path.dirname(path.join(f.data, nested)), {recursive: true});
  await fs.writeFile(path.join(f.data, nested), 'return {synthetic=true}');
  const workspace = await helperWorkspace(f, crypto.randomUUID());
  await workspace.copyInputs();
  assert.equal(
    (await workspace.read(nested)).toString(),
    'return {synthetic=true}',
  );
  await workspace.remove();
});

test('startup revokes orphaned preview, map and creation mounts before any private scratch cleanup', async (t) => {
  const f = await fixture(t),
    workers = [],
    calls = [],
    paths = [];
  for (const prefix of [
    'factorio-panel-preview-',
    'factorio-panel-map-',
    'factorio-panel-job-',
  ]) {
    const id = crypto.randomUUID(),
      preview = prefix.includes('preview'),
      child = preview ? 'preview-' + id : id;
    const workspace = await helperWorkspace(f, child);
    paths.push(workspace.work);
    workers.push({
      Id: 'immutable-' + id,
      Names: ['/' + prefix + id],
      State: 'running',
      Labels: preview
        ? {'factorio-panel.preview': 'true', 'factorio-panel.preview-id': id}
        : {'factorio-panel.job': id},
      HostConfig: {
        Mounts: [
          {
            Type: 'bind',
            Source: f.data + '/.panel-work/' + child,
            Target: '/factorio',
          },
        ],
      },
    });
  }
  const unrelated = structuredClone(workers[2]);
  unrelated.Id = 'unrelated-installation';
  unrelated.HostConfig.Mounts[0].Source =
    '/different-installation/.panel-work/' + crypto.randomUUID();
  // It has a distinct, valid name and label but belongs to another installation.
  const foreignId = crypto.randomUUID();
  unrelated.Names = ['/factorio-panel-job-' + foreignId];
  unrelated.Labels = {'factorio-panel.job': foreignId};
  workers.push(unrelated);
  const request = f.docker;
  f.docker = async (method, route) => {
    calls.push({method, route});
    if (route.startsWith('/containers/json')) return workers;
    if (route === '/containers/factorio-panel-controller/json')
      return request(method, route);
    if (method === 'GET') {
      const worker = workers.find((item) =>
        route.includes(item.Names[0] + '/json'),
      );
      assert.ok(worker);
      return {...worker, Config: {Labels: worker.Labels}};
    }
    // No path is removed while any pre-fix mount is still being revoked.
    for (const work of paths) assert.ok((await fs.stat(work)).isDirectory());
    return {};
  };
  await cleanPreviewWorkers(f.state, f);
  assert.equal(calls.filter((call) => call.method === 'DELETE').length, 3);
  assert.ok(
    calls
      .filter((call) => call.method !== 'GET')
      .every((call) => !call.route.includes(unrelated.Id)),
  );
  assert.deepEqual(await fs.readdir(path.join(f.state, '.panel-work')), []);
});

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lobby-helper-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const data = path.join(root, 'data'),
    state = path.join(root, 'state'),
    control = path.join(root, 'control');
  for (const dir of [
    data,
    state,
    control,
    path.join(data, 'mods'),
    path.join(data, 'saves'),
    path.join(data, 'config'),
  ])
    await fs.mkdir(dir);
  await fs.writeFile(
    path.join(control, 'sentinel'),
    'private control sentinel',
  );
  await fs.writeFile(
    path.join(data, 'saves/world.zip'),
    'existing synthetic world',
  );
  await fs.writeFile(path.join(data, 'mods/mod-list.json'), '{}');
  const server = {
    Image: 'test-image',
    Mounts: [{Type: 'bind', Source: data, Destination: '/factorio'}],
  };
  const calls = [];
  const docker = async (method, route, body) => {
    calls.push({method, route, body});
    if (route === '/containers/factorio-panel-controller/json')
      return {Mounts: [{Type: 'bind', Source: state, Destination: state}]};
    if (route.startsWith('/containers/create')) {
      options.onCreate?.(body);
      return {Id: 'helper'};
    }
    if (route.includes('/wait')) {
      await options.onWait?.(
        calls.find((call) => call.body)?.body.HostConfig.Mounts[0].Source,
      );
      return {StatusCode: 0};
    }
    return {};
  };
  return {root, data, state, control, server, docker, calls};
}

test('real preview lifecycle ignores hostile data scratch and preserves existing synthetic world/control bytes', async (t) => {
  const png = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    Buffer.alloc(24),
  ]);
  const f = await fixture(t, {
    onWait: (work) => fs.writeFile(path.join(work, 'preview.png'), png),
  });
  await fs.symlink('../control', path.join(f.data, '.panel-work'));
  const result = await renderWorldPreview(
    {configuration: {map_gen_settings: {}}, seed: 42},
    f,
  );
  assert.deepEqual(result, png);
  const spec = f.calls.find((call) => call.body)?.body;
  assert.ok(
    spec.HostConfig.Mounts[0].Source.startsWith(
      f.state + '/.panel-work/preview-',
    ),
  );
  assert.equal(
    await fs.readFile(path.join(f.control, 'sentinel'), 'utf8'),
    'private control sentinel',
  );
  assert.equal(
    await fs.readFile(path.join(f.data, 'saves/world.zip'), 'utf8'),
    'existing synthetic world',
  );
  assert.ok(
    (await fs.lstat(path.join(f.data, '.panel-work'))).isSymbolicLink(),
  );
  assert.deepEqual(await fs.readdir(path.join(f.state, '.panel-work')), []);
});

test('helper readback rejects leaf links, linked ancestors, hardlinks and oversized output', async (t) => {
  const f = await fixture(t),
    workspace = await helperWorkspace(f, crypto.randomUUID());
  await fs.symlink(
    path.join(f.control, 'sentinel'),
    path.join(workspace.work, 'preview.png'),
  );
  await assert.rejects(workspace.read('preview.png'), /leaves|ELOOP/);
  await fs.symlink(f.control, path.join(workspace.work, 'script-output'));
  await assert.rejects(workspace.read('script-output/sentinel'), /leaves/);
  await fs.link(
    path.join(f.control, 'sentinel'),
    path.join(workspace.work, 'hardlink'),
  );
  await assert.rejects(workspace.read('hardlink'), /Invalid/);
  await workspace.write('ordinary.bin', Buffer.alloc(20));
  await assert.rejects(workspace.read('ordinary.bin', 8), /oversized/);
  await assert.rejects(
    workspace.write('script-output/sentinel', Buffer.from('overwrite')),
    /linked directory/,
  );
  assert.equal(
    await fs.readFile(path.join(f.control, 'sentinel'), 'utf8'),
    'private control sentinel',
  );
  await workspace.remove();
});

test('helper input copies reject linked game ancestors and files without copying private bytes', async (t) => {
  const f = await fixture(t),
    workspace = await helperWorkspace(f, crypto.randomUUID());
  await fs.symlink(
    path.join(f.control, 'sentinel'),
    path.join(f.data, 'mods/unsafe.zip'),
  );
  await assert.rejects(workspace.copyInputs(), /Linked/);
  await assert.rejects(readScopedFile(f.data, 'mods/unsafe.zip'), /leaves/);
  await fs.unlink(path.join(f.data, 'mods/unsafe.zip'));
  await fs.rm(path.join(f.data, 'mods'), {recursive: true});
  await fs.symlink(f.control, path.join(f.data, 'mods'));
  await assert.rejects(workspace.copyInputs(), /Linked/);
  await assert.rejects(readScopedFile(f.data, 'mods/sentinel'), /leaves/);
  await workspace.remove();
});

test('private workspace parent links are refused during allocation and interrupted cleanup', async (t) => {
  const f = await fixture(t),
    id = crypto.randomUUID();
  await fs.symlink(f.control, path.join(f.state, '.panel-work'));
  await assert.rejects(helperWorkspace(f, id), /not private/);
  await assert.rejects(removeHelperWorkspace(f.state, id), /not private/);
  assert.deepEqual(await fs.readdir(f.control), ['sentinel']);
});

test('standalone private mount discovery preserves Windows bind and separate named-volume layouts', async (t) => {
  const f = await fixture(t);
  f.server.Mounts[0].Source = 'C:\\games\\data';
  f.docker = async () => ({
    Mounts: [{Type: 'bind', Source: 'C:\\panel\\state', Destination: f.state}],
  });
  const id = crypto.randomUUID(),
    bind = await helperWorkspace(f, id);
  assert.equal(
    bind.mount.Source,
    '/run/desktop/mnt/host/c/panel/state/.panel-work/' + id,
  );
  await bind.remove();
  f.docker = async () => ({
    Mounts: [{Type: 'volume', Name: 'private-state', Destination: f.state}],
    HostConfig: {
      Mounts: [
        {
          Type: 'volume',
          Source: 'private-state',
          Target: f.state,
          VolumeOptions: {Subpath: 'controller'},
        },
      ],
    },
  });
  const volume = await helperWorkspace(f, id);
  assert.deepEqual(volume.mount, {
    Type: 'volume',
    Source: 'private-state',
    Target: '/factorio',
    VolumeOptions: {NoCopy: true, Subpath: 'controller/.panel-work/' + id},
  });
  await volume.remove();
  f.docker = async () => ({
    Mounts: [
      {Type: 'bind', Source: 'C:\\games\\data\\state', Destination: f.state},
    ],
  });
  await assert.rejects(helperWorkspace(f, id), /overlaps/);
});

test('unconfirmed helper removal retains its private workspace for recovery', async (t) => {
  const f = await fixture(t, {
    onWait: (work) =>
      fs.writeFile(path.join(work, 'preview.png'), Buffer.alloc(32)),
  });
  const request = f.docker;
  f.docker = (method, route, body) =>
    method === 'DELETE'
      ? Promise.reject(new Error('synthetic daemon unavailable'))
      : request(method, route, body);
  await assert.rejects(
    renderWorldPreview({configuration: {map_gen_settings: {}}, seed: 42}, f),
    /daemon unavailable/,
  );
  assert.equal((await fs.readdir(path.join(f.state, '.panel-work'))).length, 1);
});
