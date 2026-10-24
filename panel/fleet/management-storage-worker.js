// Operator-only helper: explicit metadata mounts, no socket and no network.
import {
  regularFile,
  parseStorageJSON,
  publishJSON,
} from '../core/storage/files.js';
import {assert} from '../common.js';
import {
  backupManagementStorage,
  verifyManagementSnapshot,
  restoreManagementStorage,
  activateAgentManagementStorage,
} from './management-storage.js';

try {
  const supplied = process.env.PANEL_MAINTENANCE_REQUEST;
  assert(supplied === undefined || Buffer.byteLength(supplied) <= 65536,
    'Management helper request is too large.');
  const request = parseStorageJSON(supplied ??
    await regularFile('/maintenance/request.json', {max: 65536}));
  assert(
    request.id === process.env.PANEL_MAINTENANCE_ID &&
      request.fleet === process.env.FLEET_ID,
    'Management helper ownership changed.',
  );
  const operations = {
    backup: backupManagementStorage,
    verify: verifyManagementSnapshot,
    restore: restoreManagementStorage,
    'activate-agent': activateAgentManagementStorage,
  };
  assert(
    Object.hasOwn(operations, request.operation),
    'Unknown management helper operation.',
  );
  const result = {...await operations[request.operation](request), ...(supplied === undefined ? {} : {fleet: request.fleet})};
  const resultFile = supplied === undefined ? '/maintenance/result.json' :
    '/artifact/' + request.id + '/result-' + request.operation + '.json';
  const previous = await regularFile(resultFile, {optional: true, max: 65536});
  if (previous) assert(JSON.stringify(parseStorageJSON(previous)) === JSON.stringify(result), 'Management storage result changed. Preserve it for review.');
  else await publishJSON(resultFile, result);
} catch (error) {
  console.error(
    error.status
      ? error.message
      : 'Management storage maintenance failed. Keep management services stopped and preserve the private snapshot for review.',
  );
  process.exitCode = 1;
}
