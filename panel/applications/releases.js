import factorioDefinition from './factorio/definition.json' with {type: 'json'};
import rustDefinition from './rust/definition.json' with {type: 'json'};
import {factorioReleases} from './factorio/releases.js';
import {rustReleases} from './rust/releases.js';

// Trusted application adapters; shared release caching never interprets game rules.
export const applicationReleaseProviders = Object.freeze({
  factorio: factorioReleases,
  rust: rustReleases,
});

export const applicationReleasePolicies = Object.freeze({
  factorio: factorioDefinition.services[0].software,
  rust: rustDefinition.services[0].software,
});
