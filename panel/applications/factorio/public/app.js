import {mountApplication} from './application/host.js';
import {createFactorioCapabilities} from './factorio/capabilities.js';

await mountApplication({extensions: createFactorioCapabilities()});
