import {mountApplication} from './application/host.js';
import {rustMods} from './rust/mods-capability.js';

await mountApplication({extensions: {'rust.mods': rustMods}});
