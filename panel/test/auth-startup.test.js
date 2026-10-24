import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionController} from '../public/shared/session.js';

const user = {username: 'Engineer', role: 'admin', csrf: 'before'};

test('shared session waits for bootstrap and emits the authenticated session once', async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const changes = [],
    calls = [];
  const session = createSessionController({
    request: async (route) => {
      calls.push(route);
      return pending;
    },
    onChange: (value) => changes.push(value),
  });
  const boot = session.bootstrap();
  assert.equal(session.current, null);
  assert.deepEqual(changes, []);
  release(user);
  assert.equal(await boot, user);
  assert.equal(session.current, user);
  assert.deepEqual(changes, [user]);
  assert.deepEqual(calls, ['/session']);
});

for (const message of ['Please sign in.', 'Connection lost'])
  test(
    'shared session clears stale authentication after ' + message,
    async () => {
      const session = createSessionController({
        request: async () => {
          throw Error(message);
        },
      });
      session.set(user);
      assert.equal(await session.bootstrap(), null);
      assert.equal(session.current, null);
    },
  );

test('invitation bootstrap clears an old session without fetching protected data', async () => {
  const session = createSessionController({
    request: async () => assert.fail('An invitation must not fetch a session'),
  });
  session.set(user);
  assert.equal(await session.bootstrap({invitation: true}), null);
  assert.equal(session.current, null);
});

test('sign-in, registration and password rotation replace the session used for subsequent writes', async () => {
  const calls = [];
  const session = createSessionController({
    request: async (route, options) => {
      calls.push({route, options, current: session.current});
      return {...user, csrf: route};
    },
  });
  const login = {username: user.username, password: 'fixture-password'};
  await session.signIn(login);
  assert.equal(session.current.csrf, '/login');
  await session.changePassword({
    currentPassword: 'fixture-password',
    password: 'replacement-password',
  });
  assert.equal(calls.at(-1).current.csrf, '/login');
  assert.equal(session.current.csrf, '/password');
  await session.signOut();
  assert.equal(calls.at(-1).current.csrf, '/password');
  assert.equal(session.current, null);
  await session.register({...login, token: 'fixture-invitation'});
  assert.equal(session.current.csrf, '/register');
  assert.deepEqual(
    calls.map((call) => call.route),
    ['/login', '/password', '/logout', '/register'],
  );
  assert.ok(calls.every((call) => call.options.method === 'POST'));
  assert.deepEqual(calls[0].options.body, login);
});

test('failed password and sign-in requests do not replace the current session', async () => {
  const session = createSessionController({
    request: async () => {
      throw Error('Rejected');
    },
  });
  session.set(user);
  await assert.rejects(
    session.changePassword({password: 'invalid'}),
    /Rejected/,
  );
  await assert.rejects(session.signIn({username: 'invalid'}), /Rejected/);
  assert.equal(session.current, user);
});
