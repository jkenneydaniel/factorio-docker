#!/usr/bin/env node
// Test-only helper image: exercises real mounts without a native game binary.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
assert.equal(
  await fs.readFile('/factorio/mods/unpacked/prototypes/item.lua', 'utf8'),
  'nested fixture',
);
for (const file of [
  '/var/run/docker.sock',
  '/fixture/private/control/sentinel',
  '/instance/control/token',
])
  await assert.rejects(fs.access(file), {code: 'ENOENT'});
const configuration = JSON.parse(
  await fs.readFile('/factorio/config/map-gen.json', 'utf8'),
);
if (configuration.seed === 13)
  await fs.symlink(
    '/fixture/private/control/sentinel',
    '/factorio/preview.png',
  );
else
  await fs.writeFile(
    '/factorio/preview.png',
    Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(24)]),
  );
