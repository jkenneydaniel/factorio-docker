import {assert, redact} from '../common.js';
import crypto from 'node:crypto';
import {
  definitionData,
  freezeDefinition,
  isFrozenDefinition,
} from './definition-data.js';
const metadataCache = new WeakMap();

const identifier = (value) =>
  typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const roles = new Set([
  'web',
  'worker',
  'scheduler',
  'game',
  'service',
  'database',
  'cache',
]);

// A package describes a small service graph; a reviewed host driver performs
// the actual process operations. HTTP inputs cannot choose drivers or services.
export function serviceOrder(definition) {
  definitionData(definition);
  assert(
    definition &&
      Object.keys(definition).every((key) =>
        [
          'version',
          'id',
          'name',
          'revision',
          'kind',
          'primary',
          'services',
          'presentation',
          'secrets',
          'deployment',
        ].includes(key),
      ),
    'Unknown application definition field.',
  );
  assert(
    definition?.version === 1 &&
      identifier(definition.id) &&
      Number.isInteger(definition.revision) &&
      definition.revision > 0 &&
      ['game', 'application', 'service'].includes(definition.kind),
    'Invalid application definition.',
  );
  assert(
    Array.isArray(definition.services) &&
      definition.services.length > 0 &&
      definition.services.length <= 8,
    'An application needs 1–8 services.',
  );
  const secrets = definition.secrets || [];
  assert(
    Array.isArray(secrets) &&
      secrets.length <= 16 &&
      new Set(secrets.map((secret) => secret?.id)).size === secrets.length &&
      secrets.every(
        (secret) =>
          secret &&
          Object.keys(secret).every((key) =>
            ['id', 'provider'].includes(key),
          ) &&
          /^[a-z][A-Za-z0-9]{0,63}$/.test(secret.id) &&
          identifier(secret.provider),
      ),
    'Invalid private application secret references.',
  );
  const services = new Map();
  for (const service of definition.services) {
    assert(
      service &&
        Object.keys(service).every((key) =>
          [
            'id',
            'role',
            'required',
            'dependsOn',
            'profile',
            'configuration',
            'secretRefs',
          ].includes(key),
        ) &&
        identifier(service.id) &&
        roles.has(service.role) &&
        typeof service.required === 'boolean' &&
        identifier(service.profile) &&
        Array.isArray(service.dependsOn) &&
        service.dependsOn.length <= 8 &&
        service.dependsOn.every(identifier) &&
        new Set(service.dependsOn).size === service.dependsOn.length &&
        !services.has(service.id),
      'Invalid application service.',
    );
    assert(
      service.secretRefs === undefined ||
        (Array.isArray(service.secretRefs) &&
          service.secretRefs.length <= 16 &&
          new Set(service.secretRefs).size === service.secretRefs.length &&
          service.secretRefs.every((name) =>
            secrets.some((secret) => secret.id === name),
          )),
      'Service references an undeclared private secret.',
    );
    assert(
      service.configuration === undefined ||
        (service.configuration &&
          typeof service.configuration === 'object' &&
          !Array.isArray(service.configuration)),
      'Invalid runtime profile configuration.',
    );
    services.set(service.id, service);
  }
  assert(
    services.has(definition.primary) &&
      services.get(definition.primary).required,
    'Choose a required primary application service.',
  );
  const visiting = new Set(),
    visited = new Set(),
    order = [];
  function visit(id) {
    assert(services.has(id), 'Unknown application dependency.');
    assert(!visiting.has(id), 'Application dependencies contain a cycle.');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of services.get(id).dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    order.push(services.get(id));
  }
  for (const id of services.keys()) visit(id);
  return order;
}

export function applicationMetadata(definition) {
  serviceOrder(definition);
  if (isFrozenDefinition(definition) && metadataCache.has(definition))
    return metadataCache.get(definition);
  const metadata = freezeDefinition({
    version: definition.version,
    id: definition.id,
    kind: definition.kind,
    revision: definition.revision,
    sha256: definitionFingerprint(definition),
    primary: definition.primary,
    services: serviceOrder(definition).map(
      ({
        profile: _profile,
        configuration: _configuration,
        secretRefs: _secretRefs,
        ...service
      }) => service,
    ),
  });
  if (isFrozenDefinition(definition)) metadataCache.set(definition, metadata);
  return metadata;
}

export function definitionFingerprint(definition) {
  definitionData(definition);
  const canonical = (value) =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
        : value;
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical(definition)))
    .digest('hex');
}

export class ApplicationServices {
  constructor(definition, drivers, {sanitize = redact} = {}) {
    this.definition = definition;
    this.order = serviceOrder(definition);
    this.drivers = drivers;
    this.sanitize = sanitize;
    assert(
      Object.keys(drivers).length === this.order.length,
      'Application drivers differ from the service definition.',
    );
    for (const service of this.order) {
      assert(
        Object.hasOwn(drivers, service.id),
        'Missing application service driver.',
      );
      for (const method of ['inspect', 'start', 'stop', 'logs'])
        assert(
          typeof drivers[service.id]?.[method] === 'function',
          `Service driver needs ${method}.`,
        );
      assert(
        drivers[service.id].waitReady === undefined ||
          typeof drivers[service.id].waitReady === 'function',
        'Invalid service readiness hook.',
      );
    }
  }
  async invoke(service, method, ...args) {
    try {
      return await this.drivers[service.id][method](...args);
    } catch (error) {
      throw Object.assign(Error(this.sanitize(error.message)), {
        status: error.status || 502,
      });
    }
  }
  async inspect(service) {
    try {
      const state = await this.drivers[service.id].inspect();
      assert(
        state &&
          typeof state.running === 'boolean' &&
          typeof state.ready === 'boolean' &&
          (!state.ready || state.running),
        'Invalid service health response.',
        502,
      );
      return {
        id: service.id,
        role: service.role,
        required: service.required,
        running: state.running,
        ready: state.ready,
        error: state.error ? this.sanitize(String(state.error)) : null,
      };
    } catch (error) {
      return {
        id: service.id,
        role: service.role,
        required: service.required,
        running: null,
        ready: false,
        error: this.sanitize(error.message),
      };
    }
  }
  async status() {
    const states = await Promise.all(
        this.order.map((service) => this.inspect(service)),
      ),
      byId = new Map(states.map((state) => [state.id, state]));
    for (const service of this.order) {
      const state = byId.get(service.id);
      state.blockedBy = service.dependsOn.filter((id) => !byId.get(id).ready);
      if (state.blockedBy.length) state.ready = false;
    }
    const required = states.filter((state) => state.required),
      unknown = states.some((state) => state.running === null);
    return {
      services: states,
      ready: required.every((state) => state.ready),
      running: states.some((state) => state.running === true)
        ? true
        : unknown
          ? null
          : false,
      error:
        required
          .filter((state) => state.error || state.blockedBy.length)
          .map(
            (state) =>
              `${state.id}: ${state.error || 'waiting for ' + state.blockedBy.join(', ')}`,
          )
          .join('; ') || null,
    };
  }
  async start(configuration = {}) {
    const ready = new Set();
    for (const service of this.order) {
      assert(
        service.dependsOn.every((id) => ready.has(id)),
        `Dependencies for ${service.id} are not ready.`,
        409,
      );
      let state = await this.inspect(service);
      assert(
        state.running !== null,
        `Cannot inspect ${service.id}: ${state.error}`,
        503,
      );
      if (!state.running) {
        await this.invoke(service, 'start', configuration);
        state = await this.inspect(service);
      }
      // Drivers may implement a bounded readiness wait after a start. Merely
      // accepting a process start is not evidence that dependants can start.
      if (!state.ready && this.drivers[service.id].waitReady) {
        await this.invoke(service, 'waitReady');
        state = await this.inspect(service);
      }
      assert(
        state.ready,
        `${service.id} has not reached readiness. Review the service before continuing.`,
        409,
      );
      ready.add(service.id);
    }
    return this.status();
  }
  async stop() {
    for (const service of [...this.order].reverse()) {
      const state = await this.inspect(service);
      assert(
        state.running !== null,
        `Cannot inspect ${service.id}: ${state.error}`,
        503,
      );
      if (state.running) await this.invoke(service, 'stop');
      assert(
        (await this.inspect(service)).running === false,
        `${service.id} has not stopped. Review the service before continuing.`,
        409,
      );
    }
    return this.status();
  }
  async logs() {
    const records = [];
    for (const service of this.order)
      records.push(
        `[${service.id}]\n${this.sanitize(String(await this.invoke(service, 'logs'))).slice(-128 * 1024)}`,
      );
    return records.join('\n\n');
  }
}
