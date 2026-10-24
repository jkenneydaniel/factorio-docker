// Exercise held HTTP entrypoints inside the built Linux image, without a socket,
// network egress, installed data, game process or world volume.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {arena} from './fixtures/arena-game.js';
import {startController} from '../core/controller.js';
import {startWeb} from '../core/web.js';
import {closeStorage} from '../core/storage/selection.js';

assert.equal(process.platform, 'linux');
const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'lobby-runtime-hold-')),
  ),
  auth = path.join(root, 'auth'),
  token = path.join(root, 'token'),
  id = 'a'.repeat(32);
await fs.mkdir(auth);
await fs.writeFile(token, 'disposable-runtime-maintenance-token', {
  mode: 0o600,
});
let initialized = 0,
  started = 0,
  ticks = 0;
const application = arena(root),
  module = {
    ...application,
    createController: async (ctx) => {
      const game = await application.createController(ctx);
      ctx.every(() => ticks++, 5);
      return {
        ...game,
        init: async () => initialized++,
        start: async () => started++,
      };
    },
  };
const env = {
  PANEL_MAINTENANCE_ID: id,
  CONTROLLER_TOKEN_FILE: token,
  AUTH_DIR: auth,
  RELEASE_CHECKS: 'false',
  PANEL_HOSTS: '127.0.0.1',
};
const blocked = () => assert.fail('Held runtime must not contact Docker.');
let controller, web;
const close = (server) =>
  new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  });
async function request(
  server,
  route,
  {method = 'GET', body, authorized = true} = {},
) {
  const response = await fetch(
    'http://127.0.0.1:' + server.address().port + route,
    {
      method,
      headers: {
        'content-type': 'application/json',
        ...(authorized
          ? {authorization: 'Bearer disposable-runtime-maintenance-token'}
          : {}),
      },
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    },
  );
  return {status: response.status, body: await response.json()};
}
try {
  controller = await startController(module, {
    env,
    hostname: '127.0.0.1',
    port: 0,
    docker: blocked,
  });
  web = await startWeb(module, {
    env: {
      ...env,
      CONTROLLER_URL: 'http://127.0.0.1:' + controller.address().port,
    },
    hostname: '127.0.0.1',
    port: 0,
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(initialized, 0);
  assert.equal(started, 0);
  assert.equal(ticks, 0);
  for (const server of [controller, web]) {
    assert.equal(
      (await request(server, '/health', {authorized: false})).status,
      200,
    );
    assert.equal(
      (await request(server, '/management/status', {authorized: false})).status,
      401,
    );
    assert.equal((await request(server, '/management/status')).body.held, true);
    assert.equal(
      (
        await request(server, '/management/activate', {
          method: 'POST',
          body: {id: 'b'.repeat(32), confirm: true},
        })
      ).status,
      400,
    );
  }
  assert.equal(
    (
      await request(controller, '/jobs', {
        method: 'POST',
        body: {action: 'rotate', params: {}},
      })
    ).status,
    503,
  );
  assert.equal(
    (
      await request(web, '/api/login', {
        method: 'POST',
        body: {username: 'Owner', password: 'unused'},
        authorized: false,
      })
    ).status,
    503,
  );
  assert.equal(
    (
      await request(controller, '/management/activate', {
        method: 'POST',
        body: {id, confirm: true},
      })
    ).body.held,
    false,
  );
  assert.equal(initialized, 1);
  assert.equal(started, 1);
  await request(controller, '/management/activate', {
    method: 'POST',
    body: {id, confirm: true},
  });
  assert.equal(initialized, 1);
  assert.equal(started, 1);
  assert.equal(
    (
      await request(web, '/management/activate', {
        method: 'POST',
        body: {id, confirm: true},
      })
    ).body.held,
    false,
  );
  assert.equal(
    (await request(web, '/api/session', {authorized: false})).status,
    401,
  );
  await close(controller);
  controller = null;
  controller = await startController(module, {
    env,
    hostname: '127.0.0.1',
    port: 0,
    docker: blocked,
  });
  assert.equal(
    (await request(controller, '/management/status')).body.held,
    false,
  );
  assert.equal(initialized, 2);
  assert.equal(started, 2);
  console.log(
    'Linux controller/web holds, local authentication, activation, suppressed background work and restart receipts passed.',
  );
} finally {
  if (web) await close(web);
  if (controller) await close(controller);
  await closeStorage(path.join(root, 'state'));
  await closeStorage(auth);
  await fs.rm(root, {recursive: true, force: true});
}
