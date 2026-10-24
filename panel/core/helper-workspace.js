import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {assert, inside} from '../common.js';
import {validId} from './instance.js';

const within = (root, file) => file.startsWith(root + path.sep);
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const limit = 512 * 1024 * 1024;

export async function removeHelperWorker(docker, name) {
  await docker('POST', '/containers/' + name + '/stop?t=15').catch(() => {});
  try {
    await docker('DELETE', '/containers/' + name);
    return true;
  } catch (error) {
    if (error.status === 404) return true;
    throw error;
  }
}

// Check the opened object, not just the pathname checked before opening it.
// Linux is the supported container runtime; the identity check also supports
// local development tests on macOS without depending on /proc.
export async function readScopedFile(root, relative, maxBytes = limit) {
  const canonical = await fs.realpath(root),
    rootStat = await fs.stat(canonical);
  const file = inside(canonical, relative),
    resolved = await fs.realpath(file);
  assert(
    within(canonical, resolved),
    'Helper input or output leaves its storage.',
  );
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    assert(
      stat.isFile() && stat.nlink === 1 && stat.size <= maxBytes,
      'Invalid or oversized helper file.',
    );
    if (process.platform === 'linux') {
      const opened = await fs.realpath('/proc/self/fd/' + handle.fd);
      assert(
        within(canonical, opened),
        'Helper input or output leaves its storage.',
      );
    }
    const current = await fs.realpath(file);
    assert(
      within(canonical, current) &&
        same(stat, await fs.stat(current)) &&
        same(rootStat, await fs.stat(canonical)),
      'Helper file changed while opening it.',
    );
    // Bounded reads also reject a file that grows after fstat.
    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const {bytesRead} = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    assert(
      offset === stat.size &&
        same(stat, after) &&
        stat.mtimeMs === after.mtimeMs &&
        stat.ctimeMs === after.ctimeMs,
      'Helper file changed while reading it.',
    );
    return {bytes: bytes.subarray(0, offset), stat};
  } finally {
    await handle.close();
  }
}

export async function readScopedJSON(root, relative, fallback) {
  try {
    return JSON.parse(
      (await readScopedFile(root, relative, 8 * 1024 * 1024)).bytes.toString(),
    );
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw error;
  }
}

function hostPath(value) {
  let result = value.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(result))
    result =
      '/run/desktop/mnt/host/' + result[0].toLowerCase() + result.slice(2);
  return result.replace(/\/$/, '');
}

export async function helperWorkspaceMount(
  {state, server, env = {}, docker},
  name,
) {
  if (env.FLEET_ID) {
    assert(
      validId(env.FLEET_ID) &&
        validId(env.FLEET_INSTANCE) &&
        env.FLEET_VOLUME ===
          `lobby-goblin-${env.FLEET_ID}-${env.FLEET_INSTANCE}` &&
        path.resolve(state) === '/instance/state',
      'Cannot verify private managed helper storage.',
    );
    return {
      Type: 'volume',
      Source: env.FLEET_VOLUME,
      Target: '/factorio',
      VolumeOptions: {NoCopy: true, Subpath: 'state/.panel-work/' + name},
    };
  }
  const self = await docker(
    'GET',
    '/containers/' +
      encodeURIComponent(
        env.CONTROLLER_CONTAINER || 'factorio-panel-controller',
      ) +
      '/json',
  );
  const location = path.resolve(state),
    mount = self.Mounts?.filter(
      (item) =>
        location === item.Destination || within(item.Destination, location),
    ).sort((a, b) => b.Destination.length - a.Destination.length)[0];
  assert(
    mount && ['bind', 'volume'].includes(mount.Type),
    'The private controller state mount is unavailable.',
  );
  const relative = path
    .relative(mount.Destination, location)
    .split(path.sep)
    .filter(Boolean)
    .concat('.panel-work', name)
    .join('/');
  const game = server.Mounts?.find((item) => item.Destination === '/factorio');
  assert(game, 'The game data mount is unavailable.');
  if (mount.Type === 'volume') {
    assert(
      game.Type !== 'volume' || game.Name !== mount.Name,
      'Standalone helpers require state separate from game storage.',
    );
    const config = self.HostConfig?.Mounts?.find(
      (item) => item.Type === 'volume' && item.Target === mount.Destination,
    );
    const subpath = [config?.VolumeOptions?.Subpath, relative]
      .filter(Boolean)
      .join('/');
    return {
      Type: 'volume',
      Source: mount.Name,
      Target: '/factorio',
      VolumeOptions: {NoCopy: true, Subpath: subpath},
    };
  }
  const source = hostPath(mount.Source),
    gameSource = game.Type === 'bind' && hostPath(game.Source);
  assert(
    !gameSource ||
      (source !== gameSource &&
        !within(gameSource, source) &&
        !within(source, gameSource)),
    'Standalone helper state overlaps game storage.',
  );
  return {Type: 'bind', Source: source + '/' + relative, Target: '/factorio'};
}

// The game never receives this parent. A helper receives only one child and
// cannot replace its ancestors. No creation or cleanup traverses game data.
export async function helperWorkspace(
  {state, data, server, env = {}, docker},
  name,
) {
  assert(
    /^(?:preview-)?[0-9a-f-]{36}$/.test(name),
    'Invalid helper workspace identity.',
  );
  const root = await fs.realpath(state),
    gameRoot = await fs.realpath(data);
  assert(
    root !== gameRoot && !within(gameRoot, root) && !within(root, gameRoot),
    'Helper state overlaps game data.',
  );
  const mount = await helperWorkspaceMount({state, server, env, docker}, name);
  const parent = path.join(root, '.panel-work');
  await fs.mkdir(parent, {mode: 0o700}).catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });
  const parentStat = await fs.lstat(parent);
  assert(
    parentStat.isDirectory() &&
      !parentStat.isSymbolicLink() &&
      !(parentStat.mode & 0o077) &&
      parentStat.uid === process.getuid(),
    'Helper workspace parent is not private.',
  );
  const work = path.join(parent, name);
  await fs.mkdir(work, {mode: 0o700});
  const identity = await fs.lstat(work);
  async function directory(relative) {
    let current = work;
    for (const part of relative.split('/').filter(Boolean)) {
      current = inside(current, part);
      await fs.mkdir(current).catch((error) => {
        if (error.code !== 'EEXIST') throw error;
      });
      const stat = await fs.lstat(current);
      assert(
        stat.isDirectory() && !stat.isSymbolicLink(),
        'Helper output contains a linked directory.',
      );
    }
  }
  return {
    work,
    mount,
    read: (relative, maxBytes) =>
      readScopedFile(work, relative, maxBytes).then((result) => result.bytes),
    json: (relative) => readScopedJSON(work, relative),
    // Called before a worker starts or after its confirmed removal.
    async write(relative, bytes) {
      const file = inside(work, relative);
      await directory(path.relative(work, path.dirname(file)));
      const temporary = path.join(
        path.dirname(file),
        '.write-' + crypto.randomUUID(),
      );
      await fs.writeFile(temporary, bytes, {flag: 'wx', mode: 0o600});
      await fs.rename(temporary, file);
    },
    async copyInputs() {
      for (const dir of ['saves', 'config', 'mods']) await directory(dir);
      let total = 0;
      const files = [];
      let entries = 0;
      async function collect(relative, depth) {
        assert(
          depth <= 64,
          'Helper mod directory nesting exceeds the copy limit.',
        );
        const dir = inside(data, relative),
          stat = await fs.lstat(dir);
        assert(
          stat.isDirectory() && !stat.isSymbolicLink(),
          'Linked helper mod directories are not allowed.',
        );
        for (const entry of await fs.readdir(dir, {withFileTypes: true})) {
          assert(++entries <= 20000, 'Too many helper mod entries.');
          assert(
            !entry.isSymbolicLink(),
            'Linked helper mod files are not allowed.',
          );
          const item = relative + '/' + entry.name;
          if (entry.isDirectory()) await collect(item, depth + 1);
          else if (entry.isFile()) files.push(item);
          assert(files.length <= 20000, 'Too many helper mod files.');
        }
      }
      await collect('mods', 0);
      for (const item of files) {
        const {bytes} = await readScopedFile(data, item);
        total += bytes.length;
        assert(total <= limit, 'Helper mods exceed the copy limit.');
        await this.write(item, bytes);
      }
    },
    async remove() {
      assert(
        same(parentStat, await fs.lstat(parent)) &&
          same(identity, await fs.lstat(work)),
        'Helper workspace identity changed.',
      );
      await fs.rm(work, {recursive: true});
    },
  };
}

// Old data-root workspaces are deliberately left alone. Their containers can be
// stopped/removed by ownership policy, but their paths are game-controlled.
export async function removeHelperWorkspace(state, name) {
  assert(
    /^(?:preview-)?[0-9a-f-]{36}$/.test(name),
    'Invalid helper workspace identity.',
  );
  const root = await fs.realpath(state),
    parent = path.join(root, '.panel-work');
  const stat = await fs.lstat(parent).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat) return;
  assert(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      !(stat.mode & 0o077) &&
      stat.uid === process.getuid(),
    'Helper workspace parent is not private.',
  );
  await fs.rm(path.join(parent, name), {recursive: true, force: true});
}
