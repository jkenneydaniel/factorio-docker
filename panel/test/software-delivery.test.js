import test from 'node:test';
import assert from 'node:assert/strict';
import {applicationDefinition} from '../core/application-definition.js';
import {applicationMetadata} from '../core/application-services.js';
import {
  softwareDelivery,
  publicSoftwareDelivery,
  initialSoftwareVersion,
} from '../core/software-delivery.js';
import source from './fixtures/arena-definition.json' with {type: 'json'};
import presentation from './fixtures/arena-presentation.json' with {type: 'json'};

const policy = {
  version: 1,
  mode: 'runtime',
  provider: 'factorio-headless',
  initial: {channel: 'stable'},
  storage: 'application-volume',
  updates: 'manual',
};
const receipt = {
  version: 1,
  provider: 'factorio-headless',
  softwareVersion: '2.0.77',
  sha256: 'a'.repeat(64),
};
function fixture(overrides = {}) {
  const calls = [];
  const providers = {
    'factorio-headless': {
      empty: async () => true,
      installed: async (value) => {
        calls.push(['inspect', value.softwareVersion]);
        return true;
      },
      resolve: async (value) => {
        calls.push(['resolve', value.channel]);
        return {...receipt, softwareVersion: '2.1.23'};
      },
      install: async () =>
        assert.fail('Version resolution must never install software'),
      ...overrides,
    },
  };
  return {calls, providers};
}

test('runtime policy is immutable, instance-scoped metadata separate from image admission', () => {
  const value = structuredClone(source);
  value.services[0].software = structuredClone(policy);
  const definition = applicationDefinition(value, presentation),
    metadata = applicationMetadata(definition);
  assert.equal(metadata.services[0].software.updateKind, 'software');
  assert.equal(metadata.services[0].software.provider, 'factorio-headless');
  assert.equal(metadata.services[0].software.storage, undefined);
  assert.equal(metadata.services[0].configuration, undefined);
  assert.ok(Object.isFrozen(definition.services[0].software));
  assert.deepEqual(softwareDelivery(), {version: 1, mode: 'image'});
  assert.equal(publicSoftwareDelivery().updateKind, 'image');
});

test('a fresh installation resolves stable once, then a recreated container keeps its exact installed version', async () => {
  const f = fixture();
  const first = await initialSoftwareVersion(policy, {
    providers: f.providers,
    receipt: null,
  });
  assert.equal(first.install, true);
  assert.equal(first.selection.softwareVersion, '2.1.23');
  assert.deepEqual(f.calls, [['resolve', 'stable']]);
  f.calls.length = 0;
  const recreated = await initialSoftwareVersion(policy, {
    providers: f.providers,
    receipt,
  });
  assert.equal(recreated.install, false);
  assert.equal(recreated.selection.softwareVersion, '2.0.77');
  assert.deepEqual(f.calls, [['inspect', '2.0.77']]);
});

test('populated storage without a receipt cannot be silently adopted or upgraded', async () => {
  const f = fixture({empty: async () => false});
  await assert.rejects(
    initialSoftwareVersion(policy, {providers: f.providers, receipt: null}),
    /migration or recovery/,
  );
  assert.deepEqual(f.calls, []);
});

test('missing software and foreign, floating or invalid receipts fail without resolving a newer release', async () => {
  const f = fixture({installed: async () => false});
  await assert.rejects(
    initialSoftwareVersion(policy, {providers: f.providers, receipt}),
    /Recover it before starting/,
  );
  assert.deepEqual(f.calls, []);
  for (const value of [
    {...receipt, provider: 'different-installer'},
    {...receipt, softwareVersion: 'stable'},
    {...receipt, softwareVersion: '../../control'},
  ]) {
    const check = fixture();
    await assert.rejects(
      initialSoftwareVersion(policy, {
        providers: check.providers,
        receipt: value,
      }),
    );
    assert.ok(!check.calls.some((call) => call[0] === 'resolve'));
  }
});

test('definition policies cannot inject commands, credentials, host paths, auto-upgrades or ambiguous initial versions', () => {
  for (const value of [
    {...policy, command: 'curl example | sh'},
    {...policy, password: 'secret'},
    {...policy, directory: '/private'},
    {...policy, updates: 'on-restart'},
    {...policy, initial: {channel: 'stable', version: '2.0.77'}},
    {...policy, initial: {version: 'latest; rm -rf /'}},
    {...policy, storage: 'container-layer'},
    {version: 1, mode: 'image', provider: 'factorio-headless'},
  ])
    assert.throws(() => softwareDelivery(value));
});

test('unknown or incomplete installation providers and unresolved channel aliases are refused', async () => {
  await assert.rejects(
    initialSoftwareVersion(policy, {providers: {}, receipt: null}),
    /reviewed installation provider/,
  );
  const f = fixture({
    resolve: async () => ({...receipt, softwareVersion: 'stable'}),
  });
  await assert.rejects(
    initialSoftwareVersion(policy, {providers: f.providers, receipt: null}),
    /exact software version/,
  );
});
