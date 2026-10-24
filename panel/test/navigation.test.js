import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = (
  await fs.readFile(new URL('../public/scope.js', import.meta.url), 'utf8')
).replace(/^export /gm, '');
test('page navigation and API requests retain standalone, local and remote server scope', () => {
  for (const prefix of [
    '',
    '/servers/' + 'a'.repeat(32),
    '/hosts/' + 'b'.repeat(32) + '/servers/' + 'c'.repeat(32),
  ]) {
    const context = vm.createContext({location: {pathname: prefix + '/'}});
    const {serverPath, pagePath} = vm.runInContext(
      source + ';({serverPath,pagePath})',
      context,
    );
    assert.equal(serverPath('/api/status'), prefix + '/api/status');
    for (const hash of ['', '#setup', '#overview', '#worlds/created'])
      assert.equal(pagePath(hash), prefix + '/' + hash);
  }
});
