import {loadTemplates} from '../shared/templates.js';

// Standard components and reviewed extensions share the same native template
// loader. Definitions select component IDs; they never select asset paths.
export function loadApplicationTemplates() {
  return loadTemplates('/application/templates.html');
}
