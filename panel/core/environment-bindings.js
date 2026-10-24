import {assert} from '../common.js';
import {definitionData} from './definition-data.js';
import path from 'node:path';

const record = (value) =>
  value && typeof value === 'object' && !Array.isArray(value);
const field = (value) =>
  typeof value === 'string' &&
  /^[a-z][A-Za-z0-9]{0,63}$/.test(value) &&
  !['constructor', 'prototype', '__proto__'].includes(value);
const reserved = (name) =>
  /^(?:DOCKER_|FLEET_|NODE_|LD_)/.test(name) ||
  [
    'MODE',
    'GAME_MODULE',
    'PORT',
    'CONTROLLER_URL',
    'CONTROLLER_TOKEN_FILE',
    'STATE_DIR',
    'UPDATE_STATE_DIR',
    'RELEASE_CHECKS',
  ].includes(name);
const scopedPath = (value) =>
  !value.split(/[\\/]/).includes('..') &&
  !/^(?:file|unix):/i.test(value) &&
  (!value.startsWith('/') ||
    value === '/instance' ||
    path.posix.normalize(value).startsWith('/instance/') ||
    path.posix.normalize(value).startsWith('/managed/'));
export function validateEnvironmentBindings(
  bindings,
  {secrets = [], controllerPrefix} = {},
) {
  definitionData(bindings);
  assert(
    record(bindings) && Object.keys(bindings).length <= 100,
    'Invalid application environment bindings.',
  );
  for (const [name, parts] of Object.entries(bindings)) {
    assert(
      /^[A-Z][A-Z0-9_]{0,100}$/.test(name) &&
        (!controllerPrefix ||
          (!reserved(name) &&
            (name.startsWith(controllerPrefix) ||
              ['GAME_ADDRESS', 'BACKUPS_DIR'].includes(name)))),
      'Application environment cannot replace management controls.',
    );
    assert(
      Array.isArray(parts) && parts.length > 0 && parts.length <= 8,
      'Environment values need bounded literal/field/secret parts.',
    );
    for (const part of parts) {
      assert(
        record(part) && Object.keys(part).length === 1,
        'Unsupported environment binding.',
      );
      if (Object.hasOwn(part, 'literal'))
        assert(
          typeof part.literal === 'string' &&
            part.literal.length <= 4096 &&
            !/[\x00\r\n]/.test(part.literal) &&
            (!controllerPrefix || scopedPath(part.literal)),
          'Invalid or unscoped literal environment value.',
        );
      else if (Object.hasOwn(part, 'field'))
        assert(
          field(part.field) && !/password|token|secret/i.test(part.field),
          'Private values require explicit secret references.',
        );
      else
        assert(
          Object.hasOwn(part, 'secret') &&
            field(part.secret) &&
            secrets.includes(part.secret) &&
            !controllerPrefix,
          'Unapproved environment secret reference.',
        );
    }
  }
  return bindings;
}
export function renderEnvironment(
  bindings,
  fields,
  secrets = {},
  {controller = false} = {},
) {
  const result = {};
  for (const [name, parts] of Object.entries(bindings)) {
    const value = parts
      .map((part) => {
        if (Object.hasOwn(part, 'literal')) return part.literal;
        const source = Object.hasOwn(part, 'field') ? fields : secrets,
          key = part.field || part.secret,
          descriptor = Object.getOwnPropertyDescriptor(source, key),
          value = descriptor?.value;
        assert(
          descriptor &&
            Object.hasOwn(descriptor, 'value') &&
            ['string', 'number', 'boolean'].includes(typeof value) &&
            (typeof value !== 'number' || Number.isFinite(value)),
          'Application environment input is unavailable.',
        );
        return String(value);
      })
      .join('');
    assert(
      Buffer.byteLength(value) <= 4096 &&
        !/[\x00\r\n]/.test(value) &&
        (!controller || scopedPath(value)),
      'Application environment value is outside its supported bounds.',
    );
    result[name] = value;
  }
  return result;
}
