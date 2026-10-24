import {assert} from '../../common.js';
import {DocumentRepository} from '../../core/storage/document-repository.js';
import {uuidKey} from '../../core/storage/groups.js';
import {emptySetups, validateDraft} from './world-setups.js';
import {validateConfiguration} from './world-settings.js';

export function savedSetups(value) {
  assert(
    value &&
      Number.isSafeInteger(value.revision) &&
      value.revision >= 0 &&
      Array.isArray(value.presets) &&
      value.presets.length <= 20,
    'Invalid saved world setups. Preserve them for review.',
    503,
  );
  if (value.draft !== null) {
    assert(uuidKey(value.draft?.id), 'Invalid saved draft identity.', 503);
    validateDraft(value.draft);
  }
  for (const preset of value.presets) {
    assert(
      uuidKey(preset?.id) &&
        typeof preset.name === 'string' &&
        preset.name.length <= 60 &&
        typeof preset.image === 'string' &&
        preset.image.length <= 256,
      'Invalid saved world preset.',
      503,
    );
    validateConfiguration(preset.configuration);
  }
  return value;
}
export const storage = {
  version: 1,
  groups: [
    {
      id: 'factorio-world-setups',
      version: 1,
      profile: 'accounts',
      namespace: 'factorio-world-setups',
      directory: 'world-setups',
      keyFormat: 'uuid',
      schemaVersion: 1,
      decode: savedSetups,
    },
  ],
};
export class WorldSetupsRepository extends DocumentRepository {
  constructor(root, id) {
    assert(uuidKey(id), 'Invalid world setup identity.', 503);
    super(root, {
      profile: 'accounts',
      namespace: 'factorio-world-setups',
      key: id,
      file: 'world-setups/' + id + '.json',
      schemaVersion: 1,
      empty: emptySetups(),
      decode: savedSetups,
      extension: {id: storage.groups[0].id, version: storage.groups[0].version},
    });
  }
}
