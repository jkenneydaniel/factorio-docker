import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createApi,
  playerCount,
  serverState,
  sameImageReference,
} from '../public/client.js';

test('shared client keeps scoped URLs, current CSRF, JSON and raw uploads', async () => {
  const calls = [];
  let session = {csrf: 'first'};
  const api = createApi({
    base: '/hosts/host/servers/server/api',
    getSession: () => session,
    fetcher: async (...args) => {
      calls.push(args);
      return {ok: true, json: async () => ({ok: true})};
    },
  });
  await api('/status');
  assert.equal(calls[0][0], '/hosts/host/servers/server/api/status');
  assert.equal(calls[0][1].credentials, 'same-origin');
  assert.equal(calls[0][1].headers['x-csrf-token'], undefined);
  session = {csrf: 'renewed'};
  await api('jobs', {method: 'POST', body: {action: 'backup'}});
  assert.equal(calls[1][1].headers['x-csrf-token'], 'renewed');
  assert.deepEqual(JSON.parse(calls[1][1].body), {action: 'backup'});
  const archive = new Uint8Array([1, 2, 3]);
  await api('/upload?name=world.zip', {
    method: 'POST',
    body: archive,
    raw: true,
  });
  assert.equal(calls[2][1].body, archive);
  assert.equal(calls[2][1].headers['content-type'], undefined);
});

test('expired sessions use one unauthorized path while rejected login stays on its form', async () => {
  let expired = 0;
  const api = createApi({
    onUnauthorized: () => expired++,
    fetcher: async () => ({
      ok: false,
      status: 401,
      json: async () => ({error: 'Please sign in.'}),
    }),
  });
  for (const route of ['/login', '/registration', '/register'])
    await assert.rejects(api(route, {method: 'POST', body: {}}), {status: 401});
  assert.equal(expired, 0);
  await assert.rejects(api('/status'), {status: 401});
  assert.equal(expired, 1);
});

test('shared status and image matching preserve unknown states and reject different pinned digests', () => {
  assert.equal(playerCount(['a', 'b']), 2);
  assert.equal(playerCount(3), 3);
  assert.equal(playerCount(null), null);
  assert.equal(serverState(null).label, 'Unavailable');
  assert.equal(serverState({ready: true, paused: true}).label, 'Paused');
  assert.equal(serverState({running: true}).label, 'Starting');
  assert.equal(serverState({imageMigration: {}}).label, 'Needs attention');
  assert.equal(sameImageReference('game:v1@sha256:a', 'game:v1'), true);
  assert.equal(
    sameImageReference('game:v1@sha256:a', 'game:v1@sha256:b'),
    false,
  );
  assert.equal(sameImageReference('game:v1', 'game:v2'), false);
});
