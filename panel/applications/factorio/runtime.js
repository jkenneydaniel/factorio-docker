import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {assert, writeJSON} from '../../common.js';
import {readScopedFile, readScopedJSON} from '../../core/helper-workspace.js';

export const runtimeSoftware = Object.freeze({
  version: 1,
  mode: 'runtime',
  provider: 'factorio-headless',
  initial: {channel: 'stable'},
  storage: 'application-volume',
  updates: 'manual',
});
export const runtimeImagePolicy = Object.freeze({
  version: 1,
  defaultImage: 'ghcr.io/jkenneydaniel/factorio-server:runtime-fc.1',
  referencePattern:
    '^ghcr\\.io/jkenneydaniel/factorio-server:runtime-fc\\.(?<revision>[1-9]\\d*)$',
  architecture: 'amd64',
  labels: {
    'io.lobby-goblin.compatibility': '1',
    'io.lobby-goblin.software-delivery': 'runtime',
  },
  captureLabels: {'io.lobby-goblin.image-revision': 'revision'},
});
export const runtimeServer = (server) =>
  server.Config?.Labels?.['io.lobby-goblin.software-delivery'] === 'runtime';
export function runtimeReceipt(value) {
  assert(
    value?.version === 1 &&
      value.provider === 'factorio-headless' &&
      /^2\.\d{1,3}\.\d{1,4}$/.test(value.softwareVersion) &&
      /^[a-f0-9]{64}$/.test(value.sha256),
    'Invalid installed Factorio runtime receipt.',
    409,
  );
  return value;
}
export const releaseKey = (value) => {
  runtimeReceipt(value);
  return value.softwareVersion + '-' + value.sha256;
};
export const softwareIdentity = (value) =>
  value
    ? {
        version: 1,
        provider: value.provider,
        softwareVersion: value.softwareVersion,
        sha256: value.sha256,
      }
    : null;
export async function installedRuntime(data, server) {
  if (!runtimeServer(server)) return null;
  return runtimeReceipt(await readScopedJSON(data, 'runtime/installed.json'));
}
export async function runtimeIdentity(data, server) {
  const receipt = await installedRuntime(data, server);
  return [
    server.Image || server.Config.Image,
    receipt ? releaseKey(receipt) : 'image',
  ].join('/');
}
export async function runtimeDirectory(data) {
  const directory = path.join(data, 'runtime'),
    stat = await fs.lstat(directory);
  assert(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      (await fs.realpath(directory)) ===
        path.join(await fs.realpath(data), 'runtime'),
    'Runtime storage must be an ordinary directory.',
    409,
  );
  return directory;
}
export async function runtimeRequest(data, request) {
  runtimeReceipt(request);
  const root = await runtimeDirectory(data);
  for (const name of ['installed.json', 'request.json']) {
    const stat = await fs.lstat(path.join(root, name)).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    assert(
      !stat || (stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1),
      'Runtime metadata must be an ordinary file.',
      409,
    );
  }
  assert(
    !(await fs.lstat(path.join(root, 'request.json')).catch(() => null)),
    'A runtime request is already pending. Review the interrupted operation.',
    409,
  );
  // Publish without overwriting a request from another operation.
  const pending = path.join(root, '.request-' + crypto.randomUUID());
  try {
    await writeJSON(pending, request);
    await fs.link(pending, path.join(root, 'request.json'));
  } finally {
    await fs.rm(pending, {force: true});
  }
}

// Copy only receipt-verified software into controller-private scratch. The
// helper receives a read-only overlay of this copy, never a mount of game data.
export async function runtimeHelper(workspace, {data, server}) {
  const receipt = await installedRuntime(data, server);
  if (!receipt) return {mounts: [workspace.mount], env: []};
  assert(
    Array.isArray(receipt.files) &&
      receipt.files.length > 0 &&
      receipt.files.length <= 20000,
    'Invalid installed runtime inventory.',
    409,
  );
  let total = 0;
  const seen = new Set();
  for (const file of receipt.files) {
    assert(
      typeof file.name === 'string' &&
        /^[A-Za-z0-9_./ -]+$/.test(file.name) &&
        !file.name
          .split('/')
          .some((part) => !part || part === '.' || part === '..') &&
        !seen.has(file.name),
      'Unsafe installed runtime path.',
      409,
    );
    seen.add(file.name);
    assert(
      Number.isSafeInteger(file.size) &&
        file.size >= 0 &&
        (total += file.size) <= 2 * 1024 ** 3 &&
        /^[a-f0-9]{64}$/.test(file.sha256),
      'Invalid installed runtime file.',
      409,
    );
    const {bytes} = await readScopedFile(
      data,
      'runtime/releases/' + releaseKey(receipt) + '/' + file.name,
      Math.min(file.size, 512 * 1024 ** 2),
    );
    assert(
      bytes.length === file.size &&
        crypto.createHash('sha256').update(bytes).digest('hex') === file.sha256,
      'Installed Factorio files changed. Recover the verified release before generating previews.',
      409,
    );
    await workspace.write('engine/' + file.name, bytes);
    await fs.chmod(
      path.join(workspace.work, 'engine', file.name),
      file.name === 'bin/x64/factorio' ? 0o755 : 0o644,
    );
  }
  assert(
    seen.has('bin/x64/factorio') && seen.has('data/map-settings.example.json'),
    'Installed Factorio runtime is incomplete.',
    409,
  );
  const mount = workspace.mount;
  const engine =
    mount.Type === 'volume'
      ? {
          ...mount,
          Target: '/opt/factorio',
          ReadOnly: true,
          VolumeOptions: {
            ...mount.VolumeOptions,
            Subpath: mount.VolumeOptions.Subpath + '/engine',
          },
        }
      : {
          ...mount,
          Source: mount.Source + '/engine',
          Target: '/opt/factorio',
          ReadOnly: true,
        };
  return {mounts: [mount, engine], env: ['FACTORIO_RUNTIME_HELPER=true']};
}
