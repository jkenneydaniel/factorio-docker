import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {navigationAllowed} from '../public/shared/access.js';
import vm from 'node:vm';

const source = (
  await fs.readFile(new URL('../public/shell.js', import.meta.url), 'utf8')
)
  .replace(/^import .*;\n/gm, '')
  .replace(/^export /gm, '');
function fixture(options = {}) {
  const nodes = new Map();
  const node = () => ({
    dataset: {},
    children: [],
    attributes: {},
    append(child) {
      this.children.push(child);
    },
    addEventListener() {},
    setAttribute(key, value) {
      this.attributes[key] = value;
    },
    removeAttribute(key) {
      delete this.attributes[key];
    },
  });
  const find = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, node());
    return nodes.get(selector);
  };
  const body = {dataset: {}, prepend() {}},
    document = {
      body,
      createElement() {
        return {...node(), querySelector: find};
      },
      querySelector: () => null,
    };
  const context = vm.createContext({
    document,navigationAllowed,
    pagePath: (hash) => '/' + hash,
    serverPath: (value) => value,
    clearTimeout() {},
    setTimeout() {},
  });
  const mount = vm.runInContext(source + ';mountProductShell', context);
  const shell = mount({
    ...options,
    navigation: [
      {id: 'overview', label: 'Overview'},
      {id: 'settings', label: 'Settings', adminOnly: true},
    ],
  });
  return {shell, find, body};
}

test('first-run navigation is gated only for modules that provide a setup guide', () => {
  const owner = {
    username: 'Owner',
    role: 'admin',
    onboarding: {completed: false},
  };
  const rust = fixture();
  rust.shell.session(owner);
  assert.equal(
    rust.find('.product-navigation').hidden,
    false,
    'Rust has no setup guide to complete',
  );
  let insideGuide = true;
  const optionalGuide = fixture({onboarding: () => insideGuide});
  optionalGuide.shell.session(owner);
  assert.equal(optionalGuide.find('.product-navigation').hidden, true);
  insideGuide = false;
  optionalGuide.shell.session(owner);
  assert.equal(
    optionalGuide.find('.product-navigation').hidden,
    false,
    'Do this later retains navigation',
  );
  const guided = fixture({onboarding: true});
  guided.shell.session(owner);
  assert.equal(guided.find('.product-navigation').hidden, true);
  guided.shell.session({...owner, onboarding: {completed: true}});
  assert.equal(guided.find('.product-navigation').hidden, false);
});

test('shared navigation retains role visibility, active state and update discovery', () => {
  const f = fixture();
  f.shell.session({username: 'Viewer', role: 'viewer'});
  const [overview, settings] = f.find('.product-navigation').children;
  assert.equal(overview.hidden, false);
  assert.equal(settings.hidden, true);
  f.shell.session({username: 'Owner', role: 'admin'});
  assert.equal(settings.hidden, false);
  f.shell.active('settings');
  assert.equal(settings.attributes['aria-current'], 'page');
  f.shell.attention('settings', 'Panel update available');
  assert.match(settings.attributes['aria-label'], /Panel update available/);
  f.shell.attention('settings');
  assert.equal(settings.dataset.attention, 'false');
  f.shell.session(null);
  assert.equal(f.body.dataset.productSession, 'signed-out');
});
