import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {serviceApp} from './fixtures/service-app.js';
import definition from './fixtures/service-app-definition.json' with {type: 'json'};
import {createServiceApplication} from '../core/service-application.js';
import {startController} from '../core/controller.js';
import {startWeb} from '../core/web.js';
import {closeStorage} from '../core/storage/selection.js';
import {hashPassword} from '../auth.js';
import {writeJSON} from '../common.js';
import {waitForIdleJob} from './fixtures.js';

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'lobby-application-deployment-'),
  );
  let app = await serviceApp(root, options),
    controller,
    web,
    origin;
  const token = path.join(root, 'token'),
    auth = path.join(root, 'auth');
  await fs.mkdir(auth);
  await fs.writeFile(token, 'disposable-controller-token');
  const account = (grants) => ({
    ...hashPassword('disposable-application-password'),
    role: 'member',
    grants: {standalone: grants},
  });
  await writeJSON(path.join(auth, 'users.json'), {
    Owner: {...hashPassword('disposable-application-password'), role: 'admin'},
    Deployer: account(['server.view', 'application.web-stack.deploy']),
    Operator: account(['server.view', 'server.operate']),
    Read: account(['server.view']),
  });
  const env = {
    CONTROLLER_TOKEN_FILE: token,
    AUTH_DIR: auth,
    RELEASE_CHECKS: 'false',
    PANEL_HOSTS: '127.0.0.1',
  };
  async function close() {
    for (const server of [web, controller])
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    web = controller = null;
  }
  async function boot() {
    controller = await startController(app.module, {
      env,
      hostname: '127.0.0.1',
      port: 0,
      docker: () => assert.fail('Application fixtures must not access Docker.'),
    });
    web = await startWeb(app.module, {
      env: {
        ...env,
        CONTROLLER_URL: 'http://127.0.0.1:' + controller.address().port,
      },
      hostname: '127.0.0.1',
      port: 0,
    });
    origin = 'http://127.0.0.1:' + web.address().port;
  }
  t.after(async () => {
    await close();
    await closeStorage(app.config.state);
    await closeStorage(auth);
    await fs.rm(root, {recursive: true, force: true});
  });
  await boot();
  async function login(username) {
    const response = await fetch(origin + '/api/login', {
      method: 'POST',
      headers: {origin, 'content-type': 'application/json'},
      body: JSON.stringify({
        username,
        password: 'disposable-application-password',
      }),
    });
    assert.equal(response.status, 200);
    return {
      session: await response.json(),
      cookie: response.headers.get('set-cookie').split(';')[0],
    };
  }
  let owner = await login('Owner');
  async function request(
    route,
    {user = owner, method = 'GET', body, csrf = true} = {},
  ) {
    const response = await fetch(origin + route, {
      method,
      headers: {
        origin,
        cookie: user.cookie,
        'content-type': 'application/json',
        ...(csrf ? {'x-csrf-token': user.session.csrf} : {}),
      },
      ...(body !== undefined ? {body: JSON.stringify(body)} : {}),
    });
    return {status: response.status, body: await response.json()};
  }
  async function job(action, params = {}, user = owner) {
    const accepted = await request('/api/jobs', {
      user,
      method: 'POST',
      body: {action, params},
    });
    assert.equal(accepted.status, 202, JSON.stringify(accepted.body));
    return waitForIdleJob(async () => {
      const result = await request('/api/jobs');
      assert.equal(result.status, 200);
      return result.body;
    }, accepted.body.id);
  }
  return {
    root,
    get app() {
      return app;
    },
    request,
    login,
    job,
    async restart() {
      await close();
      app = await serviceApp(root, options);
      await boot();
      owner = await login('Owner');
      return app;
    },
  };
}

test('explicit deployment permission runs declared steps in order and never silently deploys on start', async (t) => {
  const f = await fixture(t, {installed: false}),
    deployer = await f.login('Deployer'),
    operator = await f.login('Operator'),
    read = await f.login('Read');
  const early = await f.job('start');
  assert.equal(early.state, 'failed');
  assert.match(early.message, /deploy/);
  assert.deepEqual(f.app.deploymentEvents, []);
  assert.deepEqual(f.app.events, []);
  for (const user of [operator, read])
    assert.equal(
      (
        await f.request('/api/jobs', {
          user,
          method: 'POST',
          body: {action: 'deploy', params: {confirm: true}},
        })
      ).status,
      403,
    );
  assert.equal(
    (
      await f.request('/api/jobs', {
        user: deployer,
        method: 'POST',
        csrf: false,
        body: {action: 'deploy', params: {confirm: true}},
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request('/api/jobs', {
        user: deployer,
        method: 'POST',
        body: {
          action: 'deploy',
          params: {confirm: true, command: 'unreviewed'},
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request('/api/jobs', {
        user: deployer,
        method: 'POST',
        body: {action: 'start', params: {}},
      })
    ).status,
    403,
  );
  const deployed = await f.job('deploy', {confirm: true}, deployer);
  assert.equal(deployed.state, 'succeeded');
  assert.equal(deployed.actor, 'Deployer');
  assert.deepEqual(f.app.deploymentEvents, ['initialize', 'cache', 'migrate']);
  assert.deepEqual(f.app.events, []);
  assert.ok(
    deployed.target.deployment.steps.every((step) => step.state === 'verified'),
  );
  assert.ok(
    deployed.operationRecord.events.some(
      (event) => event.phase === 'deployment-step',
    ),
  );
  const observations = await f.request('/api/deployment', {user: read});
  assert.equal(observations.status, 200);
  assert.deepEqual(
    observations.body.steps.map((step) => step.state),
    ['complete', 'complete', 'complete'],
  );
  assert.equal((await f.job('start', {}, operator)).state, 'succeeded');
  assert.deepEqual(f.app.events, [
    'start:web',
    'start:queue',
    'start:scheduler',
  ]);
  const live = await f.job('deploy', {confirm: true}, deployer);
  assert.equal(live.state, 'failed');
  assert.match(live.message, /Stop all/);
  assert.deepEqual(f.app.deploymentEvents, ['initialize', 'cache', 'migrate']);
  assert.equal(
    (await f.job('stop', {confirm: true}, operator)).state,
    'succeeded',
  );
  assert.equal(
    (await f.job('deploy', {confirm: true}, deployer)).state,
    'succeeded',
  );
  assert.deepEqual(
    f.app.deploymentEvents,
    ['initialize', 'cache', 'migrate'],
    'Verified steps are inspected, not submitted again.',
  );
  const history = await f.request('/api/audit');
  assert.equal(history.status, 200);
  assert.match(JSON.stringify(history.body), /Deployer/);
  assert.ok(!JSON.stringify(history.body).includes(f.app.secret));
});

test('an uncertain migration survives controller restart, blocks mutations and is resolved only by inspection without replay', async (t) => {
  const f = await fixture(t, {
    installed: false,
    secret: 'fake-private-key-never-public',
  });
  f.app.deploymentModes.migrate = 'unknown';
  const interrupted = await f.job('deploy', {confirm: true});
  assert.equal(interrupted.state, 'interrupted');
  assert.equal(interrupted.recovery.required, true);
  assert.equal(interrupted.target.deployment.steps.at(-1).state, 'submitted');
  assert.deepEqual(f.app.deploymentEvents, ['initialize', 'cache', 'migrate']);
  assert.equal(
    (
      await f.request('/api/jobs', {
        method: 'POST',
        body: {action: 'start', params: {}},
      })
    ).status,
    409,
  );
  let recovery = await f.request('/api/jobs/recovery', {
    method: 'POST',
    body: {id: interrupted.id, operation: 'inspect'},
  });
  assert.equal(recovery.status, 200);
  assert.equal(recovery.body.recovery.required, true);
  assert.equal(recovery.body.recovery.retryable, false);
  assert.match(recovery.body.recovery.message, /No task was replayed/);
  assert.equal(
    (
      await f.request('/api/jobs/recovery', {
        method: 'POST',
        body: {id: interrupted.id, operation: 'retry', confirm: true},
      })
    ).status,
    409,
  );
  await f.restart();
  assert.equal((await f.app.deploymentStates()).migrate, 'unknown');
  assert.deepEqual(f.app.deploymentEvents, []);
  recovery = await f.request('/api/jobs/recovery', {
    method: 'POST',
    body: {id: interrupted.id, operation: 'inspect'},
  });
  assert.equal(recovery.body.recovery.required, true);
  for (const route of [
    '/application-definition.json',
    '/api/jobs',
    '/api/operations',
    '/api/audit',
    '/api/status',
    '/api/services',
    '/api/logs',
    '/api/deployment',
  ]) {
    const result = await f.request(route);
    assert.equal(result.status, 200, route);
    assert.ok(
      !JSON.stringify(result.body).includes(f.app.secret),
      route + ' must not expose private provider values.',
    );
  }
  await f.app.setDeploymentState('migrate', 'complete');
  recovery = await f.request('/api/jobs/recovery', {
    method: 'POST',
    body: {id: interrupted.id, operation: 'inspect'},
  });
  assert.equal(recovery.body.state, 'succeeded');
  assert.equal(recovery.body.recovery.required, false);
  assert.deepEqual(f.app.deploymentEvents, []);
  assert.equal((await f.job('start')).state, 'succeeded');
});

test('postcondition evidence accepts a lost response and distinguishes a proven absent step from an unknown result', async (t) => {
  const f = await fixture(t, {installed: false});
  f.app.deploymentModes.cache = 'absent';
  const failed = await f.job('deploy', {confirm: true});
  assert.equal(failed.state, 'failed');
  assert.equal(failed.target.deployment.steps[1].state, 'not-applied');
  assert.equal(failed.recovery?.required, undefined);
  assert.deepEqual(f.app.deploymentEvents, ['initialize', 'cache']);
  f.app.deploymentModes.cache = 'lost-response';
  const done = await f.job('deploy', {confirm: true});
  assert.equal(done.state, 'succeeded');
  assert.deepEqual(f.app.deploymentEvents, [
    'initialize',
    'cache',
    'cache',
    'migrate',
  ]);
  assert.ok(!JSON.stringify(done).includes(f.app.secret));
});

test('application configuration and private providers are checked before drivers run and public metadata strips private bindings', async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'lobby-application-private-'),
  );
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const f = await serviceApp(root),
    next = structuredClone(definition);
  next.services[2].secretRefs = [];
  delete next.services[2].configuration.environment.APP_KEY;
  const scoped = {},
    profile = {
      ...f.profiles['synthetic-process'],
      create: async (ctx, service, {secrets}) => {
        scoped[service.id] = secrets;
        return {
          inspect: async () => ({
            running: false,
            ready: false,
            error: f.secret,
          }),
          start: async () => {
            throw Error('Driver failure ' + f.secret);
          },
          stop: async () => {},
          logs: async () => f.secret,
        };
      },
    };
  const options = {
    configuration: () => f.config,
    profiles: {'synthetic-process': profile},
    secretProviders: {'fixture-key': async () => f.secret},
    backup: {files: async () => [], validate: () => ({files: 0})},
  };
  const module = createServiceApplication(next, options),
    controller = await module.createController({
      config: f.config,
      env: {},
      active: null,
    });
  assert.deepEqual(scoped.scheduler, {});
  assert.deepEqual(scoped.web, {appKey: f.secret});
  assert.ok(Object.isFrozen(scoped.web));
  assert.ok(!JSON.stringify(module.application).includes('fixture-key'));
  assert.ok(!JSON.stringify(module.application).includes('secretRefs'));
  assert.ok(!JSON.stringify(module.application).includes('configuration'));
  assert.ok(!JSON.stringify(await controller.status()).includes(f.secret));
  assert.ok(
    !(await controller.handle(
      {method: 'GET'},
      {
        writeHead() {},
        end(body) {
          assert.ok(!body.includes(f.secret));
        },
      },
      new URL('http://fixture/logs'),
    )),
  );
  await assert.rejects(
    () => controller.actions.start(),
    (error) =>
      !error.message.includes(f.secret) && error.message.includes('[redacted]'),
  );
  assert.throws(
    () => createServiceApplication(next, {...options, secretProviders: {}}),
    /registered private provider/,
  );
  const unavailable = createServiceApplication(next, {
    ...options,
    secretProviders: {
      'fixture-key': async () => {
        throw Error(f.secret);
      },
    },
  });
  await assert.rejects(
    () => unavailable.createController({config: f.config, env: {}}),
    (error) => error.status === 503 && !error.message.includes(f.secret),
  );
  const unscoped = structuredClone(next);
  unscoped.services[0].configuration.storage.shared = ['../../control'];
  assert.throws(
    () => createServiceApplication(unscoped, options),
    /scoped names/,
  );
  const command = structuredClone(next);
  command.services[0].configuration.command = 'arbitrary';
  assert.throws(
    () => createServiceApplication(command, options),
    /Unsupported/,
  );
  const task = structuredClone(next);
  task.deployment.steps[0].task = 'unregistered';
  assert.throws(
    () => createServiceApplication(task, options),
    /reviewed tasks/,
  );
  await f.module.createController({config: f.config, env: {}});
  assert.equal(f.storage.web.shared.uploads, f.storage.queue.shared.uploads);
  assert.notEqual(f.storage.web.private.cache, f.storage.queue.private.cache);
  for (const location of [
    f.storage.web.shared.uploads,
    f.storage.web.private.cache,
    f.storage.queue.private.cache,
  ])
    await fs.mkdir(location, {recursive: true});
  await fs.writeFile(
    path.join(f.storage.web.shared.uploads, 'sentinel'),
    'shared',
  );
  assert.equal(
    await fs.readFile(
      path.join(f.storage.queue.shared.uploads, 'sentinel'),
      'utf8',
    ),
    'shared',
  );
  await fs.writeFile(
    path.join(f.storage.web.private.cache, 'sentinel'),
    'private',
  );
  await assert.rejects(
    () => fs.readFile(path.join(f.storage.queue.private.cache, 'sentinel')),
    {code: 'ENOENT'},
  );
});
