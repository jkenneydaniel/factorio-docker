import {assert} from '../common.js';
import {definitionData, freezeDefinition} from './definition-data.js';
import {
  applicationMetadata,
  definitionFingerprint,
  serviceOrder,
} from './application-services.js';
const registered = new WeakSet();
export const isApplicationDefinition = (value) =>
  !!value && typeof value === 'object' && registered.has(value);

export function applicationDefinition(source, presentation) {
  if(isApplicationDefinition(source) && (presentation===undefined || presentation===source.presentation))return source;
  definitionData(source);
  if (presentation === undefined) presentation = source?.presentation;
  definitionData(presentation);
  const definition = {...source, presentation};
  serviceOrder(definition);
  assert(
    typeof definition.name === 'string' &&
      definition.name.length > 0 &&
      definition.name.length <= 100,
    'Application definition needs a display name.',
  );
  assert(
    presentation.id === definition.id &&
      presentation.kind === definition.kind &&
      presentation.revision === definition.revision,
    'Application and presentation identities or revisions differ.',
  );
  const frozen = freezeDefinition(definition);
  registered.add(frozen);
  return frozen;
}
export function validateDefinitionBinding(module) {
  if (!module.definition) return;
  const definition = isApplicationDefinition(module.definition)
    ? module.definition
    : applicationDefinition(module.definition, module.presentation);
  assert(
    definition.id === module.id && definition.name === module.name,
    'Runtime module differs from its application definition.',
  );
  assert(
    module.presentation === definition.presentation ||
      definitionFingerprint(definitionData(module.presentation)) ===
        definitionFingerprint(definition.presentation),
    'Presentation differs from its application definition.',
  );
  const metadata = applicationMetadata(definition);
  assert(
    module.application === metadata ||
      definitionFingerprint(definitionData(module.application)) ===
        definitionFingerprint(metadata),
    'Public application metadata differs from its definition.',
  );
}
