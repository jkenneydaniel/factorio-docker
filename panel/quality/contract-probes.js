import {createSessionController} from '../public/shared/session.js';
import {createOperationController} from '../public/shared/operations.js';
import {applicationRoutes} from '../public/application/definition.js';
import {actionAvailable} from '../public/application/action-forms.js';

/**
 * Compile-time probes only; this function is never called.
 * @param {import('../public/shared/contracts.js').SessionRequest} sessionApi
 * @param {import('../public/shared/contracts.js').OperationControllerOptions} options
 * @param {import('../public/shared/contracts.js').OperationRequest} operationApi
 */
export function contractProbes(sessionApi, options, operationApi) {
  const session = createSessionController({request: sessionApi});
  const operations = createOperationController(options);
  void session.signIn({username: 'Example', password: 'fixture'});
  void operations.start('backup', {});
  // @ts-expect-error Account requests use structured form values.
  void session.signIn('invalid');
  void operations.update({
    // @ts-expect-error Recovery coordination does not accept invented terminal states.
    jobs: [{id: 'x', action: 'backup', state: 'complete', message: 'invalid'}],
    active: null,
  });
  // @ts-expect-error Read requests cannot silently send operation bodies.
  void operationApi('/jobs', {method: 'GET', body: {action: 'backup'}});
  // @ts-expect-error Retry waiting policy is boolean.
  void operations.start('start', {}, {wait: 'yes'});
  applicationRoutes({
    version: 1,
    id: 'fixture',
    revision: 1,
    // @ts-expect-error Application kinds do not grant host administration.
    kind: 'host-admin',
    screens: [],
  });
  // @ts-expect-error Availability uses the fixed shared vocabulary.
  actionAvailable({ready: true}, 'execute-anything');
}
