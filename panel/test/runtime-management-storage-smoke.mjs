// Run the actual operator worker against disposable tmpfs metadata only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {managementStorageSlots} from '../fleet/management-storage.js';

assert.equal(process.platform, 'linux');
assert.equal(process.getuid(), 0);
const fleet = 'a'.repeat(32),
  id = 'b'.repeat(32),
  instance = 'c'.repeat(32);
assert.equal(process.env.FLEET_ID, fleet);
assert.equal(process.env.PANEL_MAINTENANCE_ID, id);
await assert.rejects(() => fs.access('/var/run/docker.sock'), {code: 'ENOENT'});
const request = {
  version: 1,
  id,
  fleet,
  instances: [{id: instance, game: 'arena'}],
  operation: 'backup',
  confirm: true,
  offline: true,
};
const slots = managementStorageSlots(request);
for (const slot of slots) await fs.mkdir('/storage/' + slot.id, {mode: 0o700});
async function write(file, content) {
  await fs.mkdir(file.slice(0, file.lastIndexOf('/')), {
    recursive: true,
    mode: 0o700,
  });
  await fs.writeFile(file, content, {mode: 0o600});
}
await write('/storage/host/.fleet-owner.json', JSON.stringify({fleet}));
await write('/storage/host/registry.json', 'original registry');
for (const [kind, value] of [
  ['broker-state', 'state'],
  ['broker-transport', 'transport'],
])
  await write(
    '/storage/' + kind + '/.docker-broker-owner.json',
    JSON.stringify({version: 1, fleet, kind: value}),
  );
await write(
  '/storage/broker-state/capabilities.json',
  'private capability bytes',
);
await write('/storage/broker-transport/host/token', 'private host token');
await write(
  '/storage/broker-transport/instances/' + instance + '/token',
  'private instance token',
);
await fs.mkdir('/storage/broker-transport/socket');
await write('/storage/web/auth/users.json', 'original accounts');
await write('/storage/web/secrets/controller-token', 'private token');
await write('/storage/controller-' + instance + '/jobs.json', 'original jobs');
await write(
  '/storage/updates-' + instance + '/native.json',
  'original native recovery',
);
await write(
  '/storage/control-' + instance + '/controller-token',
  'private child token',
);
const owned = '/storage/web/auth/users.json';
await fs.chown(owned, 1000, 1000);
await fs.chmod(owned, 0o640);
await write('/tmp/unmounted-world-sentinel', 'outside metadata authority');
async function run(operation, manifestHash) {
  await fs.rm('/maintenance/result.json', {force: true});
  await write(
    '/maintenance/request.json',
    JSON.stringify({
      ...request,
      operation,
      ...(manifestHash ? {manifestHash} : {}),
    }),
  );
  await import('../fleet/management-storage-worker.js?operation=' + operation);
  const result = JSON.parse(
    await fs.readFile('/maintenance/result.json', 'utf8'),
  );
  assert.equal(result.operation, operation);
  assert.equal(result.id, id);
  return result;
}
const backup = await run('backup');
assert.equal(backup.slots, 7);
await write('/storage/web/auth/users.json', 'failed-version accounts');
await write(
  '/storage/controller-' + instance + '/new-format.json',
  'failed-version metadata',
);
await run('verify', backup.manifestHash);
await run('restore', backup.manifestHash);
assert.equal(await fs.readFile(owned, 'utf8'), 'original accounts');
const stat = await fs.stat(owned);
assert.equal(stat.uid, 1000);
assert.equal(stat.gid, 1000);
assert.equal(stat.mode & 0o777, 0o640);
await assert.rejects(
  () => fs.access('/storage/controller-' + instance + '/new-format.json'),
  {code: 'ENOENT'},
);
assert.equal(
  await fs.readFile('/storage/updates-' + instance + '/native.json', 'utf8'),
  'original native recovery',
);
await run('activate-agent');
const activated = JSON.parse(
  await fs.readFile('/storage/web/management-activation.json', 'utf8'),
);
assert.equal(activated.id, id);
assert.equal(activated.activated, true);
assert.equal(
  await fs.readFile('/tmp/unmounted-world-sentinel', 'utf8'),
  'outside metadata authority',
);
console.log(
  'Linux operator worker backup, verification, raw restore, ownership preservation and agent receipt checks passed without daemon/world mounts.',
);
