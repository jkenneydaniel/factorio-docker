import test from 'node:test';
import assert from 'node:assert/strict';
import {Linter} from 'eslint';
import {nativeTemplates} from './template-rules.mjs';
import {moduleImports, resolveAsset} from './assets.mjs';
const assets = {
  '/rust/app.js': ['rust/app.js', 'text/javascript'],
  '/shared/session.js': ['shared/session.js', 'text/javascript'],
};
test('served import graph resolves nested modules inside a remote server scope', () => {
  assert.equal(
    resolveAsset(
      assets,
      '/rust/app.js',
      '../shared/session.js',
      '/hosts/host/servers/server',
    ),
    '/shared/session.js',
  );
  assert.deepEqual(
    moduleImports(
      "import './a.js'; export {b} from './b.js'; export * from './c.js'; const d=()=>import('./d.js');",
    ),
    ['./a.js', './b.js', './c.js', './d.js'],
  );
});
test('packaged extensions can import shared components through their declared browser routes', () => {
  assert.equal(
    resolveAsset(
      assets,
      '/rust/app.js',
      '../shared/session.js',
      '/servers/server',
      {
        '/rust/app.js': '/fixture/application/public',
        '/shared/session.js': '/fixture/shared/public',
      },
    ),
    '/shared/session.js',
  );
  assert.throws(
    () =>
      resolveAsset(
        assets,
        '/rust/app.js',
        '../../../session.js',
        '/servers/server',
        {'/rust/app.js': '/fixture/application/public'},
      ),
    /escapes/,
  );
});
test('served import graph rejects missing modules, physical aliases, bare imports and scope escapes', () => {
  assert.throws(
    () => resolveAsset(assets, '/rust/app.js', './missing.js'),
    /Unserved/,
  );
  assert.throws(
    () =>
      resolveAsset(
        {
          ...assets,
          '/shared/session.js': ['other/session.js', 'text/javascript'],
        },
        '/rust/app.js',
        '../shared/session.js',
      ),
    /disagree/,
  );
  assert.throws(
    () => resolveAsset(assets, '/rust/app.js', 'package-name'),
    /must be relative/,
  );
  assert.throws(
    () =>
      resolveAsset(
        assets,
        '/rust/app.js',
        '../../../session.js',
        '/servers/server',
      ),
    /escapes/,
  );
  assert.throws(
    () => moduleImports('const path="./a.js"; import(path);'),
    /statically declared/,
  );
});

test('capability controllers use native templates instead of embedded or parsed markup', () => {
  const linter = new Linter(),
    config = [
      {
        plugins: {product: {rules: {templates: nativeTemplates}}},
        rules: {'product/templates': 'error'},
      },
    ];
  for (const source of [
    "const view = '<button type=button>Install</button>';",
    'const view = `<p>${message}</p>`;',
    'root.innerHTML = content;',
    "root['outerHTML'] = content;",
    'document.createRange().createContextualFragment(content);',
  ]) {
    assert.ok(linter.verify(source, config).length, source);
  }
  assert.equal(
    linter.verify(
      "root.replaceChildren(template('operation')); label.textContent = name; const message = 'X < Y';",
      config,
    ).length,
    0,
  );
});
