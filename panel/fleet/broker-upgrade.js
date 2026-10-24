import crypto from 'node:crypto';
import {assert} from '../common.js';
import {validId, resources} from '../core/instance.js';
import {registeredApplications} from '../applications/index.js';
import {brokerCompose} from './broker-compose.js';
import {brokerSocket, brokerToken} from '../core/broker-client.js';

const fingerprint = (value) =>
  crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Pure planning over supplied metadata. No engine/file access, commands or apply
// function. An operator must separately verify and authorize any future upgrade.
export function planBrokerUpgrade({
  fleet,
  runtimeReference,
  registry,
  containers,
}) {
  assert(
    validId(fleet) &&
      /^ghcr\.io\/jkenneydaniel\/lobby-goblin@sha256:[a-f0-9]{64}$/.test(
        runtimeReference,
      ),
    'Use a reviewed, pinned runtime image.',
  );
  assert(
    registry?.version === 1 &&
      Array.isArray(registry.servers) &&
      Array.isArray(containers),
    'Supply an existing registry and container inspection metadata.',
  );
  assert(
    !(registry.jobs || []).some(
      (job) =>
        ['running', 'queued', 'interrupted'].includes(job.state) ||
        job.recovery?.required,
    ),
    'Review existing operations before planning an isolation upgrade.',
    409,
  );
  const host = containers.find(
    (value) => value.Name === '/lobby-goblin-host-' + fleet,
  );
  assert(
    host?.Config?.Labels?.['io.lobby-goblin.fleet'] === fleet &&
      host.Config.Labels['io.lobby-goblin.role'] === 'host-controller',
    'Host manager ownership changed.',
    409,
  );
  assert(
    host.Mounts?.every(
      (mount) =>
        (mount.Type === 'volume' &&
          ['state', 'library', 'web'].some(
            (suffix) =>
              mount.Name === 'lobby-goblin-fleet-' + fleet + '-' + suffix,
          )) ||
        (mount.Type === 'bind' &&
          mount.Source === '/var/run/docker.sock' &&
          mount.Destination === '/var/run/docker.sock'),
    ),
    'Custom host-manager mounts require manual review.',
    409,
  );
  const broker = brokerCompose(runtimeReference, fleet),
    servers = [];
  for (const item of registry.servers.filter(
    (value) => value.state !== 'removed',
  )) {
    const module = registeredApplications().find((value) => value.id === item.game),
      expected = resources(fleet, item.id, item.game);
    assert(
      module &&
        Object.entries(expected).every(([key, value]) => item[key] === value) &&
        item.state === 'installed' &&
        !item.maintenance &&
        (!item.migration || item.migration.state === 'complete'),
      'Only intact, established instances can be planned automatically.',
      409,
    );
    const game = containers.find(
        (value) => value.Name === '/' + item.container,
      ),
      controller = containers.find(
        (value) => value.Name === '/' + item.controller,
      );
    for (const info of [game, controller])
      assert(
        info?.Id &&
          info.Config?.Labels?.['io.lobby-goblin.fleet'] === fleet &&
          info.Config.Labels['io.lobby-goblin.instance'] === item.id &&
          info.Config.Labels['io.lobby-goblin.game'] === item.game,
        'Instance container ownership changed.',
        409,
      );
    assert(
      game.Config.Image === item.image &&
        game.Mounts?.length === 1 &&
        game.Mounts[0].Type === 'volume' &&
        game.Mounts[0].Name === item.volume &&
        game.Mounts[0].Destination === module.managed.dataTarget &&
        game.HostConfig?.Mounts?.length === 1 &&
        game.HostConfig.Mounts[0].VolumeOptions?.Subpath === 'data',
      'Game image or data layout requires manual review.',
      409,
    );
    assert(
      !game.HostConfig.Privileged &&
        !game.HostConfig.Binds?.length &&
        !game.HostConfig.Devices?.length &&
        !['host'].includes(game.HostConfig.PidMode) &&
        game.HostConfig.IpcMode !== 'host' &&
        game.HostConfig.NetworkMode === item.network &&
        !game.HostConfig.CapAdd?.some((value) =>
          ['SYS_ADMIN', 'NET_ADMIN', 'ALL'].includes(value),
        ),
      'Privileged game configuration requires manual review.',
      409,
    );
    assert(
      controller.Mounts?.length === 2 &&
        controller.Mounts.some(
          (mount) =>
            mount.Type === 'volume' &&
            mount.Name === item.volume &&
            mount.Destination === '/instance',
        ) &&
        controller.Mounts.some(
          (mount) =>
            mount.Type === 'bind' &&
            mount.Source === '/var/run/docker.sock' &&
            mount.Destination === '/var/run/docker.sock',
        ) &&
        Object.keys(controller.NetworkSettings?.Networks || {}).length === 1 &&
        controller.NetworkSettings.Networks[item.network],
      'Custom controller storage or networking requires manual review.',
      409,
    );
    // Deliberately exclude Config.Env: the plan must not copy RCON/controller
    // secrets into a review artifact. Paths and environment additions are fixed.
    servers.push({
      id: item.id,
      game: item.game,
      unchangedGame: {
        container: item.container,
        id: game.Id,
        image: game.Image,
        reference: game.Config.Image,
        metadataHash: fingerprint({
          id: game.Id,
          image: game.Image,
          reference: game.Config.Image,
          mounts: game.Mounts,
          host: game.HostConfig,
          networks: game.NetworkSettings,
        }),
      },
      controller: {
        container: item.controller,
        expectedId: controller.Id,
        preserveVolume: item.volume,
        preserveNetwork: item.network,
        replaceRuntime: runtimeReference,
        removeMount: '/var/run/docker.sock',
        addMounts: [
          {
            Type: 'volume',
            Source: 'lobby-goblin-fleet-' + fleet + '-broker-transport',
            Target: '/broker/socket',
            ReadOnly: true,
            VolumeOptions: {Subpath: 'socket', NoCopy: true},
          },
          {
            Type: 'volume',
            Source: 'lobby-goblin-fleet-' + fleet + '-broker-transport',
            Target: '/broker/credential',
            ReadOnly: true,
            VolumeOptions: {Subpath: 'instances/' + item.id, NoCopy: true},
          },
        ],
        environment: {
          DOCKER_BROKER_SOCKET: brokerSocket,
          DOCKER_BROKER_TOKEN_FILE: brokerToken,
        },
      },
    });
  }
  assert(
    new Set(servers.map((value) => value.id)).size === servers.length,
    'Duplicate instance identities.',
  );
  return {
    version: 1,
    kind: 'review-only-broker-upgrade',
    fleet,
    runtimeReference,
    hostId: host.Id,
    registryHash: fingerprint(registry),
    broker: {service: broker.service, volumes: broker.volumes},
    hostChanges: {
      removeMount: '/var/run/docker.sock',
      addMounts: broker.mounts,
      environment: {...broker.environment, FLEET_SKIP_MIGRATIONS: 'true'},
    },
    servers,
    review: [
      'Verify a tested matching runtime and preserve private management state/recovery records.',
      'Prepare the broker and issue each server capability before replacing its controller.',
      'Replace management services and controllers only after separate authorization; keep all game containers and data mounts unchanged.',
      'Verify game IDs, images, network and mount fingerprints, broker access, controller readiness, and unrelated-server preservation.',
      'Mark isolationVersion=1 only for controllers verified to have no daemon socket. Do not point an unconverted registry at the broker.',
    ],
    appliesChanges: false,
  };
}
