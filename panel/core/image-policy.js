import {assert} from '../common.js';

export function imageMatch(policy, reference) {
  if (
    !policy ||
    typeof reference !== 'string' ||
    reference.length > 512 ||
    /\s/.test(reference)
  )
    return null;
  const [tag, digest, extra] = reference.split('@');
  if (
    extra !== undefined ||
    (digest !== undefined && !/^sha256:[a-f0-9]{64}$/.test(digest))
  )
    return null;
  return new RegExp(policy.referencePattern).exec(tag);
}

export function validateImagePolicy(policy) {
  assert(
    policy?.version === 1 &&
      ['amd64', 'arm64'].includes(policy.architecture) &&
      typeof policy.referencePattern === 'string' &&
      policy.referencePattern.length <= 512 &&
      policy.referencePattern.startsWith('^') &&
      policy.referencePattern.endsWith('$'),
    'Invalid game image policy.',
  );
  const match = imageMatch(policy, policy.defaultImage);
  assert(match, 'Default image must satisfy its game policy.');
  for (const key of ['labels', 'captureLabels'])
    assert(
      policy[key] &&
        typeof policy[key] === 'object' &&
        !Array.isArray(policy[key]) &&
        Object.keys(policy[key]).length <= 32 &&
        Object.entries(policy[key]).every(
          ([name, value]) =>
            /^[a-zA-Z0-9_.-]{1,128}$/.test(name) &&
            typeof value === 'string' &&
            value.length > 0 &&
            value.length <= 200,
        ),
      'Invalid game image labels.',
    );
  assert(
    Object.values(policy.captureLabels).every((value) => match.groups?.[value]),
    'Image labels reference an undeclared capture.',
  );
  return policy;
}

export async function ensureGameImage(docker, policy, reference) {
  validateImagePolicy(policy);
  const match = imageMatch(policy, reference);
  assert(match, 'Image must satisfy the reviewed game image policy.', 409);
  let image;
  const inspect = () =>
    docker('GET', '/images/' + encodeURIComponent(reference) + '/json');
  try {
    image = await inspect();
  } catch (error) {
    if (error.status !== 404) throw error;
    const at = reference.indexOf('@'),
      colon = reference.lastIndexOf(':'),
      fromImage = at >= 0 ? reference.slice(0, at) : reference.slice(0, colon),
      tag = at >= 0 ? reference.slice(at + 1) : reference.slice(colon + 1);
    const output = await docker(
      'POST',
      '/images/create?' +
        new URLSearchParams({
          fromImage,
          tag,
          platform: 'linux/' + policy.architecture,
        }),
      undefined,
      {raw: true, timeout: 1200000},
    );
    for (const line of output.toString().split('\n').filter(Boolean))
      assert(
        !JSON.parse(line).error,
        'The game image could not be downloaded. Existing containers were preserved.',
        502,
      );
    image = await inspect();
  }
  const labels = image.Config?.Labels || {};
  assert(
    image.Architecture === policy.architecture &&
      image.Os === 'linux' &&
      Object.entries(policy.labels).every(
        ([key, value]) => labels[key] === value,
      ) &&
      Object.entries(policy.captureLabels).every(
        ([key, capture]) => labels[key] === match.groups[capture],
      ),
    'The image does not satisfy its game contract.',
    409,
  );
  assert(
    /^sha256:[a-f0-9]{64}$/.test(image.Id),
    'The image has no immutable identity.',
    409,
  );
  const tag = reference.split('@')[0],
    repository = tag.slice(0, tag.lastIndexOf(':'));
  const digest = image.RepoDigests?.find(
    (value) =>
      value.startsWith(repository + '@sha256:') &&
      /^sha256:[a-f0-9]{64}$/.test(value.split('@')[1]),
  );
  assert(
    digest,
    'Publish the tested image before using it in managed installations.',
    409,
  );
  const resolved = tag + '@' + digest.split('@')[1];
  assert(
    !reference.includes('@') || resolved === reference,
    'The game image digest changed.',
    409,
  );
  return {image, reference: resolved};
}
