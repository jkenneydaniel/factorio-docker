export function brokerCompose(image, id) {
  const project = 'lobby-goblin-fleet-' + id;
  return {
    service: {
      image,
      container_name: 'lobby-goblin-docker-broker-' + id,
      user: '0:0',
      restart: 'unless-stopped',
      read_only: true,
      cap_drop: ['ALL'],
      security_opt: ['no-new-privileges:true'],
      mem_limit: '512m',
      cpus: 1,
      pids_limit: 128,
      network_mode: 'none',
      tmpfs: ['/tmp'],
      labels: {
        'io.lobby-goblin.fleet': id,
        'io.lobby-goblin.role': 'docker-broker',
      },
      environment: {MODE: 'docker-broker', FLEET_ID: id},
      volumes: [
        '/var/run/docker.sock:/var/run/docker.sock',
        'broker-state:/broker-state',
        'broker-transport:/broker-transport',
      ],
      logging: {
        driver: 'json-file',
        options: {'max-size': '5m', 'max-file': '2'},
      },
    },
    environment: {
      DOCKER_BROKER_SOCKET: '/broker/socket/docker.sock',
      DOCKER_BROKER_TOKEN_FILE: '/broker/credential/token',
      FLEET_BROKER_VOLUME: project + '-broker-transport',
    },
    mounts: [
      {
        type: 'volume',
        source: 'broker-transport',
        target: '/broker/socket',
        read_only: true,
        volume: {subpath: 'socket', nocopy: true},
      },
      {
        type: 'volume',
        source: 'broker-transport',
        target: '/broker/credential',
        read_only: true,
        volume: {subpath: 'host', nocopy: true},
      },
    ],
    volumes: Object.fromEntries(
      ['broker-state', 'broker-transport'].map((name) => [
        name,
        {
          name: project + '-' + name,
          labels: {'io.lobby-goblin.fleet': id, 'io.lobby-goblin.role': name},
        },
      ]),
    ),
  };
}
