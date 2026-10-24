// Opt-in acceptance inside a separately prepared, disposable Docker host.
// This is never selected by the normal test runner or a product entrypoint.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {docker, demultiplex} from '../core/docker.js';
import {resources} from '../core/instance.js';

const owner = '01a16598-733c-7232-bd99-1d6b06086183';
const {
  ACCEPTANCE_ENGINE_ID: engine,
  ACCEPTANCE_RUNTIME: runtime,
  ACCEPTANCE_RUNNER: runner,
  ACCEPTANCE_FLEET: fleet,
} = process.env;
assert.equal(
  process.env.ACCEPTANCE_OWNER,
  owner,
  'Explicit disposable-host authority is required.',
);
assert.equal(
  (await fs.readFile('/acceptance-owner', 'utf8')).trim(),
  owner + ' disposable platform acceptance only',
);
assert.ok(engine && /^[a-f0-9-]{36}$/.test(engine));
assert.match(runtime || '', /^sha256:[a-f0-9]{64}$/);
assert.match(fleet || '', /^[a-f0-9]{32}$/);
assert.match(runner || '', /^lobby-acceptance-runner-[a-f0-9]{12}$/);
assert.equal(process.env.DOCKER_SOCKET, '/var/run/docker.sock');
assert.equal(process.env.DOCKER_BROKER_SOCKET, undefined);
assert.equal(process.env.DOCKER_BROKER_TOKEN_FILE, undefined);
assert.equal(
  (await docker('GET', '/info')).ID,
  engine,
  'The selected engine identity changed.',
);
const verify = process.env.ACCEPTANCE_VERIFY_PROVISIONED === 'true';
assert.ok(process.env.ACCEPTANCE_VERIFY_PROVISIONED === undefined || verify);
const initial = await docker('GET', '/containers/json?all=1');
assert.ok(
  initial.some(
    (value) =>
      value.Names.includes('/' + runner) &&
      value.Labels['io.lobby-goblin.acceptance'] === owner,
  ),
);
if (!verify)
  assert.equal(
    initial.length,
    1,
    'Fresh provisioning requires only its operator runner.',
  );
else
  assert.ok(
    initial.every(
      (value) =>
        value.Labels['io.lobby-goblin.fleet'] === fleet ||
        value.Labels['io.lobby-goblin.acceptance'] === owner,
    ),
    'Verification found unrelated containers.',
  );
const image = await docker('GET', '/images/' + runtime + '/json');
assert.equal(image.Config.Labels['io.lobby-goblin.runtime'], '1');
const project = 'lobby-goblin-fleet-' + fleet,
  host = 'lobby-goblin-host-' + fleet,
  broker = 'lobby-goblin-docker-broker-' + fleet;
const network = project + '-management',
  labels = (role) => ({
    'io.lobby-goblin.fleet': fleet,
    'io.lobby-goblin.role': role,
  });
const volume = (suffix, target, extra = {}) => ({
  Type: 'volume',
  Source: project + '-' + suffix,
  Target: target,
  ...extra,
});
const route = (name, tail) =>
  '/containers/' + encodeURIComponent(name) + '/' + tail;
const info = (name) => docker('GET', route(name, 'json'));
const sleep = () => new Promise((resolve) => setTimeout(resolve, 200));
async function until(read, label, timeout = 90000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const result = await read();
      if (result) return result;
    } catch (error) {
      if (error.fatal) throw error;
      last = error;
    }
    await sleep();
  }
  throw Error(label + (last ? ': ' + last.message : ''));
}
async function absent(method, path) {
  await assert.rejects(
    () => docker(method, path),
    (error) => error.status === 404,
  );
}
async function create(name, spec) {
  await absent('GET', route(name, 'json'));
  const result = await docker(
    'POST',
    '/containers/create?' + new URLSearchParams({name}),
    spec,
  );
  await docker('POST', route(result.Id, 'start'));
  return result.Id;
}
function tarFile(buffer, filename) {
  for (let offset = 0; offset + 512 <= buffer.length;) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const text = (start, end) =>
      header.subarray(start, end).toString().replace(/\0.*$/s, '');
    const name = text(0, 100),
      size = parseInt(text(124, 136).trim() || '0', 8);
    assert.ok(
      Number.isSafeInteger(size) &&
        size >= 0 &&
        offset + 512 + size <= buffer.length,
    );
    if (name === filename) {
      assert.ok(header[156] === 0 || header[156] === 48);
      return buffer.subarray(offset + 512, offset + 512 + size);
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.fail(
    'The owned fixture archive did not contain its expected regular file.',
  );
}
async function file(container, location) {
  return tarFile(
    await docker(
      'GET',
      route(container, 'archive') + '?' + new URLSearchParams({path: location}),
      undefined,
      {raw: true},
    ),
    location.split('/').at(-1),
  );
}
async function execute(container, code) {
  const {Id} = await docker('POST', route(container, 'exec'), {
    AttachStdout: true,
    AttachStderr: true,
    Cmd: ['node', '--input-type=module', '-e', code],
  });
  const output = demultiplex(
    await docker(
      'POST',
      '/exec/' + Id + '/start',
      {Detach: false, Tty: false},
      {raw: true},
    ),
  );
  const result = await docker('GET', '/exec/' + Id + '/json');
  assert.equal(
    result.ExitCode,
    0,
    'Owned fixture assertion failed: ' + output.slice(-2000),
  );
  return output;
}

// Only newly named fleet resources are created. Evidence is retained on failure;
// this script never stops/removes a game, world, volume or pre-existing service.
if (!verify) {
  for (const suffix of [
    'state',
    'library',
    'web',
    'broker-state',
    'broker-transport',
  ]) {
    await absent('GET', '/volumes/' + project + '-' + suffix);
    await docker('POST', '/volumes/create', {
      Name: project + '-' + suffix,
      Labels: labels(suffix.startsWith('broker') ? suffix : 'host-storage'),
    });
  }
  await absent('GET', '/networks/' + network);
  await docker('POST', '/networks/create', {
    Name: network,
    Driver: 'bridge',
    CheckDuplicate: true,
    Labels: labels('host-network'),
  });
  await docker('POST', '/networks/' + network + '/connect', {
    Container: runner,
  });
  await create(broker, {
    Image: runtime,
    User: '0:0',
    Env: ['MODE=docker-broker', 'FLEET_ID=' + fleet],
    Labels: labels('docker-broker'),
    HostConfig: {
      NetworkMode: 'none',
      ReadonlyRootfs: true,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges:true'],
      Memory: 512 * 1024 ** 2,
      NanoCpus: 1e9,
      PidsLimit: 128,
      Tmpfs: {'/tmp': ''},
      Mounts: [
        {
          Type: 'bind',
          Source: '/var/run/docker.sock',
          Target: '/var/run/docker.sock',
        },
        volume('broker-state', '/broker-state'),
        volume('broker-transport', '/broker-transport'),
      ],
    },
  });
  await until(async () => {
    const value = await info(broker);
    assert.equal(value.State.Running, true);
    return value.State.Health?.Status === 'healthy';
  }, 'Docker broker did not reach health');
  const env = {
    MODE: 'fleet-controller',
    PORT: '8091',
    FLEET_ID: fleet,
    FLEET_IMAGE: runtime,
    FLEET_HOST_CONTAINER: host,
    FLEET_STATE_VOLUME: project + '-state',
    FLEET_LIBRARY_VOLUME: project + '-library',
    FLEET_BROKER_VOLUME: project + '-broker-transport',
    DOCKER_BROKER_SOCKET: '/broker/socket/docker.sock',
    DOCKER_BROKER_TOKEN_FILE: '/broker/credential/token',
    FLEET_MEMORY_GIB: '4',
    FLEET_GAME_ADDRESS: '127.0.0.1',
    FLEET_GAME_BIND: '127.0.0.1',
    FLEET_GAME_PORT_BASE: '45000',
    FLEET_AGENT_ONLY: 'true',
    RELEASE_CHECKS: 'false',
  };
  await create(host, {
    Image: runtime,
    User: '0:0',
    Env: Object.entries(env).map(([key, value]) => key + '=' + value),
    Labels: labels('host-controller'),
    HostConfig: {
      NetworkMode: network,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges:true'],
      Memory: 1024 ** 3,
      NanoCpus: 1e9,
      Mounts: [
        volume('state', '/fleet'),
        volume('library', '/library'),
        volume('web', '/web-state'),
        volume('broker-transport', '/broker/socket', {
          ReadOnly: true,
          VolumeOptions: {Subpath: 'socket', NoCopy: true},
        }),
        volume('broker-transport', '/broker/credential', {
          ReadOnly: true,
          VolumeOptions: {Subpath: 'host', NoCopy: true},
        }),
      ],
    },
  });
  await until(async () => {
    const response = await fetch('http://' + host + ':8091/health', {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  }, 'Host controller did not reach health');
} else {
  const existing = await docker('GET', '/networks/' + network);
  assert.equal(existing.Labels['io.lobby-goblin.fleet'], fleet);
  await docker('POST', '/networks/' + network + '/connect', {
    Container: runner,
  });
}
const token = (await file(host, '/web-state/secrets/controller-token'))
  .toString()
  .trim();
async function request(path, {method = 'GET', body} = {}) {
  const response = await fetch('http://' + host + ':8091' + path, {
    method,
    headers: {
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
      'x-panel-user': 'Disposable acceptance',
    },
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  assert.ok(
    response.ok,
    'Owned application request failed: ' + JSON.stringify(result),
  );
  return result;
}
async function jobDone(id, prefix = '') {
  return until(
    async () => {
      const value = await request(prefix + '/jobs'),
        job = value.jobs.find((job) => job.id === id);
      if (job && !['queued', 'running'].includes(job.state) && !value.active) {
        if (job.state !== 'succeeded')
          throw Object.assign(Error('Owned operation failed: ' + job.message), {
            fatal: true,
          });
        return job;
      }
      return null;
    },
    'An owned application operation did not complete',
    120000,
  );
}
const checkpointFile = '/acceptance-output/provisioned.json';
let instances = [];
if (!verify) {
  for (const name of ['Acceptance one', 'Acceptance two']) {
    const job = await request('/servers', {
      method: 'POST',
      body: {
        name,
        game: 'arena',
        cpu: 1,
        memoryGiB: 1,
        maxPlayers: 8,
        autoStart: true,
        tickRate: 20,
      },
    });
    const done = await jobDone(job.id),
      id = done.result.serverId,
      item = {id, ...resources(fleet, id, 'arena')};
    const prefix = '/servers/' + id + '/controller';
    await until(async () => {
      const value = await request(prefix + '/status');
      return value.ready;
    }, 'The owned game did not reach readiness');
    instances.push(item);
  }

  for (const item of instances) {
    const game = await info(item.container),
      controller = await info(item.controller);
    Object.assign(item, {containerId: game.Id, controllerId: controller.Id});
  }
  await fs.writeFile(
    checkpointFile,
    JSON.stringify(
      {version: 1, owner, engine, fleet, runtime, instances},
      null,
      2,
    ) + '\n',
    {flag: 'wx', mode: 0o600},
  );
} else {
  const checkpoint = JSON.parse(await fs.readFile(checkpointFile, 'utf8'));
  for (const [key, value] of Object.entries({
    version: 1,
    owner,
    engine,
    fleet,
    runtime,
  }))
    assert.equal(
      checkpoint[key],
      value,
      'Provisioned fixture identity changed.',
    );
  assert.equal(checkpoint.instances.length, 2);
  instances = checkpoint.instances;
  for (const item of instances) {
    assert.match(item.id, /^[a-f0-9]{32}$/);
    for (const [key, value] of Object.entries(
      resources(fleet, item.id, 'arena'),
    ))
      assert.equal(item[key], value);
    assert.equal((await info(item.container)).Id, item.containerId);
    assert.equal((await info(item.controller)).Id, item.controllerId);
  }
}
for (const item of instances) {
  const game = await info(item.container),
    controller = await info(item.controller);
  assert.equal(game.Mounts.length, 1);
  assert.equal(game.Mounts[0].Destination, '/arena');
  assert.equal(game.Mounts[0].Name, item.volume);
  assert.equal(game.HostConfig.Mounts[0].VolumeOptions.Subpath, 'data');
  assert.ok(controller.Mounts.every((mount) => mount.Type === 'volume'));
  assert.equal(
    controller.Mounts.find(
      (mount) => mount.Destination === '/broker/credential',
    ).Name,
    project + '-broker-transport',
  );
  const boundary = await execute(
    item.controller,
    `import fs from 'node:fs';const response=await fetch(${JSON.stringify('http://' + item.container + ':7777/boundary')});const value=await response.json();if(Object.values(value).some(Boolean)||fs.existsSync('/var/run/docker.sock')||fs.existsSync('/broker/host/token'))throw Error('Management authority escaped its scope.');console.log('Scoped game/controller mounts verified.');`,
  );
  assert.match(boundary, /verified/);
}
const [one, two] = instances;
const denied = await execute(
  one.controller,
  `
  import assert from 'node:assert/strict';import fs from 'node:fs';import {brokerClient} from '/app/core/broker-client.js';
  const client=brokerClient({socketPath:process.env.DOCKER_BROKER_SOCKET,tokenFile:process.env.DOCKER_BROKER_TOKEN_FILE});
  for(const [method,route,data] of ${JSON.stringify([
    ['GET', '/version'],
    ['GET', '/events'],
    ['GET', route(two.container, 'json')],
    ['GET', '/volumes/' + two.volume],
    ['GET', '/networks/' + two.network],
    [
      'POST',
      '/containers/create?name=unreviewed-helper',
      {
        Image: runtime,
        HostConfig: {
          Privileged: true,
          Mounts: [
            {
              Type: 'bind',
              Source: '/var/run/docker.sock',
              Target: '/var/run/docker.sock',
            },
          ],
        },
      },
    ],
  ])})await assert.rejects(()=>client.docker(method,route,data),error=>[403,409].includes(error.status));
  const details=await client.docker('GET','/info');assert.deepEqual(Object.keys(details).sort(),['Architecture','OSType','ServerVersion']);
  const listed=await client.docker('GET','/containers/json?all=1');assert.ok(listed.length>0&&listed.every(value=>value.Labels['io.lobby-goblin.instance']===${JSON.stringify(one.id)}));
  assert.equal(fs.existsSync('/broker/credential/host/token'),false);console.log('Six cross-instance/host/creation requests denied. Reduced metadata and filtered listing verified.');
`,
);
assert.match(denied, /Six/);
const beforeRotate = (await request('/servers/' + one.id + '/controller/score'))
  .score;
assert.ok(
  beforeRotate === 0 || (verify && beforeRotate === 1),
  'Unexpected fixture state; no rotation submitted.',
);
if (beforeRotate === 0) {
  const rotated = await request('/servers/' + one.id + '/controller/jobs', {
    method: 'POST',
    body: {
      action: 'rotate',
      params: {},
      requestId: 'acceptance-rotate-' + fleet,
    },
  });
  await jobDone(rotated.id, '/servers/' + one.id + '/controller');
}
assert.equal(
  (await request('/servers/' + one.id + '/controller/score')).score,
  1,
);
assert.equal(
  (await request('/servers/' + two.id + '/controller/score')).score,
  0,
);
const proof = {
  version: 1,
  owner,
  engine,
  fleet,
  runtime,
  host,
  broker,
  network,
  instances: [],
};
for (const item of instances) {
  const value = await info(item.container);
  proof.instances.push({
    ...item,
    containerId: value.Id,
    image: value.Image,
    reference: value.Config.Image,
    startedAt: value.State.StartedAt,
    mounts: value.Mounts,
    hostConfig: value.HostConfig,
    worldHash: crypto
      .createHash('sha256')
      .update(await file(item.container, '/arena/matches/current.json'))
      .digest('hex'),
  });
}
await fs.writeFile(
  '/acceptance-output/runtime-proof.json',
  JSON.stringify(proof, null, 2) + '\n',
  {flag: 'wx', mode: 0o600},
);
console.log(
  'Two fresh Arena instances provisioned through the real broker. Scoped mounts and six denial checks passed; fixture bytes/identities recorded.',
);
