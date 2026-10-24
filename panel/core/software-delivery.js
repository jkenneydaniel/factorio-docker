import {assert} from '../common.js';
import {definitionData, freezeDefinition} from './definition-data.js';

const imageDelivery = freezeDefinition({version: 1, mode: 'image'});
const identifier = (value) =>
  typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => keys.includes(key));

// Image identity and application identity are independent. A declaration selects
// trusted provider code; it never supplies commands, credentials or host paths.
export function softwareDelivery(value) {
  if (value === undefined) return imageDelivery;
  definitionData(value);
  assert(
    exact(value, [
      'version',
      'mode',
      'provider',
      'initial',
      'storage',
      'updates',
    ]) &&
      value.version === 1 &&
      ['image', 'runtime'].includes(value.mode),
    'Invalid application software delivery policy.',
  );
  if (value.mode === 'image') {
    assert(
      Object.keys(value).every((key) => ['version', 'mode'].includes(key)),
      'Image-bundled software cannot declare a runtime installer.',
    );
  } else {
    assert(
      identifier(value.provider),
      'Runtime software needs a registered provider name.',
    );
    assert(
      exact(value.initial, ['version', 'channel']) &&
        Object.keys(value.initial).length === 1,
      'Choose an exact initial software version or one release channel.',
    );
    const selection = value.initial.version ?? value.initial.channel;
    assert(
      typeof selection === 'string' &&
        /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(selection),
      'Invalid initial software version or channel.',
    );
    assert(
      value.initial.version === undefined ||
        !['latest', 'stable', 'experimental', 'public'].includes(
          value.initial.version,
        ),
      'An exact initial version cannot be a floating channel.',
    );
    assert(
      value.storage === 'application-volume',
      'Runtime software must survive container replacement in its application volume.',
    );
    assert(
      value.updates === 'manual',
      'Runtime software changes require an explicit reviewed update.',
    );
  }
  return freezeDefinition(value);
}

export function publicSoftwareDelivery(value) {
  const policy = softwareDelivery(value);
  return policy.mode === 'image'
    ? {version: 1, mode: 'image', updateKind: 'image'}
    : {
        version: 1,
        mode: 'runtime',
        provider: policy.provider,
        initial: policy.initial,
        updates: policy.updates,
        updateKind: 'software',
      };
}

export function validateSoftwareProvider(policy, providers) {
  policy = softwareDelivery(policy);
  if (policy.mode === 'image') return null;
  const provider =
    Object.hasOwn(providers, policy.provider) && providers[policy.provider];
  assert(
    provider &&
      ['resolve', 'installed', 'empty', 'install'].every(
        (method) => typeof provider[method] === 'function',
      ),
    'Runtime software needs a reviewed installation provider.',
  );
  return provider;
}

// Resolve a floating initial channel only for empty storage. Recreating a
// container must use its installed receipt, even if the upstream channel moved.
export async function initialSoftwareVersion(policy, {providers, receipt}) {
  policy = softwareDelivery(policy);
  assert(
    policy.mode === 'runtime',
    'Image-bundled software is provided by its image.',
  );
  const provider = validateSoftwareProvider(policy, providers);
  if (receipt !== null && receipt !== undefined) {
    definitionData(receipt);
    assert(
      receipt.version === 1 &&
        receipt.provider === policy.provider &&
        typeof receipt.softwareVersion === 'string' &&
        /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(receipt.softwareVersion) &&
        !['latest', 'stable', 'experimental', 'public'].includes(
          receipt.softwareVersion,
        ),
      'Installed software receipt needs recovery; no version was changed.',
      409,
    );
    assert(
      await provider.installed(receipt),
      'Installed software is missing or differs from its receipt. Recover it before starting.',
      409,
    );
    return {selection: structuredClone(receipt), install: false};
  }
  assert(
    await provider.empty(),
    'Existing application storage has no software receipt. Explicit migration or recovery is required.',
    409,
  );
  const selected = await provider.resolve(structuredClone(policy.initial));
  definitionData(selected);
  assert(
    selected?.version === 1 &&
      selected.provider === policy.provider &&
      typeof selected.softwareVersion === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(selected.softwareVersion),
    'Software provider did not resolve an exact version.',
    503,
  );
  assert(
    !['latest', 'stable', 'experimental', 'public'].includes(
      selected.softwareVersion,
    ),
    'Resolve the channel to an exact software version before installing.',
    503,
  );
  return {selection: freezeDefinition(selected), install: true};
}
