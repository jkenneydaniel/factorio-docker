import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'espree';
import {sharedAssets} from '../core/web-assets.js';
import {web as factorioWeb} from '../applications/factorio/web.js';
import {rust} from '../applications/rust/index.js';
import {fleetAssets} from '../fleet/web-assets.js';
import {applicationAssets} from '../core/application-web.js';

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
export function moduleImports(source, file = 'module.js') {
  const tree = parse(source, {ecmaVersion: 'latest', sourceType: 'module'}),
    imports = [];
  function visit(node) {
    if (
      [
        'ImportDeclaration',
        'ExportNamedDeclaration',
        'ExportAllDeclaration',
      ].includes(node.type) &&
      node.source
    )
      imports.push(node.source.value);
    if (node.type === 'ImportExpression') {
      if (
        node.source.type !== 'Literal' ||
        typeof node.source.value !== 'string'
      )
        throw Error(
          'Browser imports must have a statically declared path: ' + file,
        );
      imports.push(node.source.value);
    }
    for (const value of Object.values(node))
      if (Array.isArray(value)) {
        for (const child of value) if (child?.type) visit(child);
      } else if (value?.type) visit(value);
  }
  visit(tree);
  return imports;
}
export function resolveAsset(
  assets,
  route,
  reference,
  prefix = '',
  roots = {},
) {
  if (!reference.startsWith('.'))
    throw Error(
      'Browser imports must be relative: ' + route + ' → ' + reference,
    );
  const resolved = new URL(reference, 'https://panel.invalid' + prefix + route)
    .pathname;
  if (prefix && !resolved.startsWith(prefix + '/'))
    throw Error(
      'Import escapes its server scope: ' + route + ' → ' + reference,
    );
  const key = resolved.slice(prefix.length);
  if (!assets[key])
    throw Error('Unserved browser module: ' + route + ' → ' + reference);
  const physical = path.resolve(
    roots[route] || publicRoot,
    path.dirname(assets[route][0]),
    reference,
  );
  if (
    (roots[route] || publicRoot) === (roots[key] || publicRoot) &&
    physical !== path.resolve(roots[key] || publicRoot, assets[key][0])
  )
    throw Error(
      'Browser and source import paths disagree: ' + route + ' → ' + reference,
    );
  return key;
}
export async function checkAssets() {
  let count = 0;
  for (const [area, web] of Object.entries({
    factorio: factorioWeb,
    rust: rust.web,
    fleet: {assets: fleetAssets},
    application: {assets: applicationAssets},
  })) {
    const assets = {...sharedAssets, ...web.assets};
    const roots = Object.fromEntries(
      Object.keys(assets).map((route) => [
        route,
        Object.hasOwn(web.assets, route) && web.publicRoot
          ? fileURLToPath(web.publicRoot)
          : publicRoot,
      ]),
    );
    for (const [route, [file, type]] of Object.entries(assets)) {
      const source = await fs.readFile(path.join(roots[route], file), 'utf8');
      if (type.startsWith('text/javascript')) {
        for (const reference of moduleImports(source, file))
          for (const prefix of [
            '',
            '/servers/' + 'a'.repeat(32),
            '/hosts/' + 'b'.repeat(32) + '/servers/' + 'c'.repeat(32),
          ])
            resolveAsset(assets, route, reference, prefix, roots);
        count++;
      }
      if (type.startsWith('text/css'))
        for (const match of source.matchAll(/@import\s+['"]([^'"]+)['"]/g)) {
          const key = new URL(match[1], 'https://panel.invalid' + route)
            .pathname;
          if (!assets[key])
            throw Error('Unserved stylesheet: ' + area + ' ' + key);
        }
    }
  }
  console.log(
    `Verified ${count} browser modules across standalone, local-server and remote-server scopes.`,
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await checkAssets();
