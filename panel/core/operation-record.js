import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {assert, redact} from '../common.js';
import {syncDirectory} from './storage/files.js';

const onlyKeys = (value, keys) =>
  value &&
  typeof value === 'object' &&
  Object.keys(value).every((key) => keys.includes(key));
const states = new Set([
  'queued',
  'running',
  'succeeded',
  'failed',
  'interrupted',
]);
const kinds = new Set([
  'application',
  'lifecycle',
  'configuration',
  'provisioning',
  'backup',
  'mods',
  'update',
  'host-setup',
]);
const identifier = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const clean = (value) =>
  redact(String(value ?? ''))
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .slice(0, 1200);
const stamp = (value) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? value
    : null;

// A native workflow retains its own state machine and recovery files. This
// checked, data-only envelope is saved in that SAME record, including by workers
// which outlive the controller. No request parameters, secrets or file contents
// are copied into the envelope or its phase history.
export function describeOperation(record, descriptor) {
  const {
    source,
    action,
    kind = 'application',
    state = record.state,
    phase = record.phase || state,
  } = descriptor;
  assert(
    identifier(record.id) &&
      identifier(source) &&
      identifier(action) &&
      kinds.has(kind) &&
      states.has(state) &&
      identifier(phase),
    'Invalid operation descriptor.',
    500,
  );
  const saved = record.operationRecord;
  if (saved)
    assert(
      saved.version === 1 &&
        saved.source === source &&
        saved.sourceId === record.id &&
        saved.action === action &&
        saved.kind === kind &&
        Array.isArray(saved.events) &&
        saved.events.length <= 128 &&
        saved.events.every(
          (event, index) =>
            Number.isSafeInteger(event.sequence) &&
            event.sequence > 0 &&
            states.has(event.state) &&
            identifier(event.phase) &&
            stamp(event.at) &&
            (!index || event.sequence === saved.events[index - 1].sequence + 1),
        ),
      'Operation identity changed. Preserve the workflow record for review.',
      503,
    );
  const recovery = descriptor.recovery;
  assert(
    !recovery || typeof recovery.required === 'boolean',
    'Invalid operation recovery descriptor.',
    500,
  );
  const actions = recovery?.actions || [];
  assert(
    Array.isArray(actions) &&
      actions.length <= 4 &&
      actions.every(
        (item) =>
          ['inspect', 'acknowledge', 'open'].includes(item.id) &&
          typeof item.label === 'string' &&
          item.label.length <= 100 &&
          (item.id !== 'open' || /^#[a-z][a-z0-9/-]{0,100}$/.test(item.href)),
      ),
    'Invalid operation recovery controls.',
    500,
  );
  const result = {
    version: 1,
    id: source + ':' + record.id,
    source,
    sourceId: record.id,
    action,
    kind,
    state,
    phase,
    actor: clean(saved?.actor || record.actor || 'unknown').slice(0, 100),
    started: stamp(saved?.started || record.started),
    updated: stamp(
      saved?.updated || record.updated || record.finished || record.started,
    ),
    finished: stamp(record.finished),
    message: clean(descriptor.message ?? record.message),
    recorded: !!saved,
    events:
      saved?.events.map((event) => ({
        sequence: event.sequence,
        at: stamp(event.at),
        state: event.state,
        phase: event.phase,
        ...(event.actor && {actor: clean(event.actor).slice(0, 100)}),
      })) || [],
    ...(saved?.parentId && {parentId: saved.parentId}),
    ...(recovery && {
      recovery: {
        required: recovery.required,
        message: clean(recovery.message),
        actions: actions.map((item) => ({
          id: item.id,
          label: clean(item.label),
          ...(item.href && {href: item.href}),
        })),
      },
    }),
  };
  return result;
}
export function recordOperation(
  record,
  descriptor,
  {at = new Date().toISOString(), parentId, actor} = {},
) {
  assert(stamp(at), 'Invalid operation timestamp.', 500);
  const view = describeOperation(record, descriptor),
    previous = record.operationRecord;
  assert(
    parentId === undefined || identifier(parentId),
    'Invalid parent operation ID.',
    500,
  );
  assert(
    !previous?.parentId ||
      parentId === undefined ||
      parentId === previous.parentId,
    'Parent operation identity changed.',
    500,
  );
  const last = previous?.events.at(-1),
    events = [...(previous?.events || [])];
  if (!last || last.state !== view.state || last.phase !== view.phase)
    events.push({
      sequence: (last?.sequence || 0) + 1,
      at,
      state: view.state,
      phase: view.phase,
      actor: clean(
        actor || record.recoveryActor || record.actor || 'unknown',
      ).slice(0, 100),
    });
  record.operationRecord = {
    version: 1,
    source: view.source,
    sourceId: record.id,
    action: view.action,
    kind: view.kind,
    actor: view.actor,
    started: view.started || at,
    updated: at,
    ...(previous?.parentId || parentId
      ? {parentId: previous?.parentId || parentId}
      : {}),
    events: events.slice(-128),
  };
  return record;
}
export async function writeOperationRecord(file, record, descriptor, options) {
  recordOperation(record, descriptor, options);
  const directory = path.dirname(file);
  await fs.mkdir(directory, {recursive: true, mode: 0o700});
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(record, null, 2));
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, file);
    await syncDirectory(directory);
  } finally {
    await handle?.close();
    await fs.rm(temporary, {force: true});
  }
}
export const operationKind = (action) =>
  /backup|snapshot|restore/.test(action)
    ? 'backup'
    : /mod|framework|plugin/.test(action)
      ? 'mods'
      : /create|remove|provision/.test(action)
        ? 'provisioning'
        : /settings|config/.test(action)
          ? 'configuration'
          : ['start', 'stop', 'restart', 'save'].includes(action)
            ? 'lifecycle'
            : 'application';
export function jobOperation(job) {
  return describeOperation(job, {
    source: 'jobs',
    action: job.action,
    kind: operationKind(job.action),
    recovery: job.recovery && {
      required: !!job.recovery.required,
      message: job.recovery.message || job.message,
      actions: job.recovery.required
        ? [
            {id: 'inspect', label: 'Check outcome'},
            ...(job.recovery.checkedAt
              ? [{id: 'acknowledge', label: 'Acknowledge review'}]
              : []),
          ]
        : [],
    },
  });
}

export function validateOperationView(record, source) {
  const allowed = [
    'version',
    'id',
    'source',
    'sourceId',
    'action',
    'kind',
    'state',
    'phase',
    'actor',
    'started',
    'updated',
    'finished',
    'message',
    'recorded',
    'events',
    'parentId',
    'recovery',
  ];
  assert(
    record &&
      Object.keys(record).every((key) => allowed.includes(key)) &&
      record.version === 1 &&
      record.source === source &&
      identifier(record.sourceId) &&
      record.id === source + ':' + record.sourceId &&
      identifier(record.action) &&
      identifier(record.phase) &&
      kinds.has(record.kind) &&
      states.has(record.state),
    'Invalid operation view identity.',
  );
  assert(
    typeof record.actor === 'string' &&
      record.actor.length <= 100 &&
      typeof record.message === 'string' &&
      record.message.length <= 1200 &&
      typeof record.recorded === 'boolean' &&
      ['started', 'updated', 'finished'].every(
        (key) => record[key] === null || stamp(record[key]),
      ),
    'Invalid operation view metadata.',
  );
  assert(
    Array.isArray(record.events) &&
      record.events.length <= 128 &&
      record.events.every(
        (event) =>
          onlyKeys(event, ['sequence', 'at', 'state', 'phase', 'actor']) &&
          Number.isSafeInteger(event.sequence) &&
          event.sequence > 0 &&
          stamp(event.at) &&
          states.has(event.state) &&
          identifier(event.phase),
      ),
    'Invalid operation phase history.',
  );
  if (record.parentId !== undefined)
    assert(identifier(record.parentId), 'Invalid parent operation reference.');
  if (record.recovery) {
    const recovery = record.recovery;
    assert(
      onlyKeys(recovery, ['required', 'message', 'actions']) &&
        typeof recovery.required === 'boolean' &&
        typeof recovery.message === 'string' &&
        recovery.message.length <= 1200 &&
        Array.isArray(recovery.actions) &&
        recovery.actions.length <= 4 &&
        recovery.actions.every(
          (action) =>
            onlyKeys(action, ['id', 'label', 'href']) &&
            ['inspect', 'acknowledge', 'open'].includes(action.id) &&
            typeof action.label === 'string' &&
            action.label.length <= 100 &&
            (action.id !== 'open' ||
              /^#[a-z][a-z0-9/-]{0,100}$/.test(action.href)),
        ),
      'Invalid operation recovery view.',
    );
  }
  return record;
}
