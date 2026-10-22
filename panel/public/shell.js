import {pagePath, serverPath} from './scope.js';
import {serverState} from './client.js';

// The same shell surrounds fleet and game screens, including standalone installs.
export function mountProductShell({
  area = 'server',
  game = '',
  onboarding = false,
  navigation = [],
  onLogout = () => {},
} = {}) {
  const root = document.createElement('div');
  root.className = 'product-shell';
  root.hidden = true;
  root.innerHTML = `<header class="product-header"><a class="product-brand" aria-label="Lobby Goblin home"><span class="product-mark" aria-hidden="true">LG</span><span>Lobby Goblin</span></a><div class="product-context"><a class="product-back">All servers</a><span class="product-context-label"></span><strong class="product-context-name"></strong></div><span class="product-status" role="status">Checking…</span><div class="product-account"><span class="product-user"></span><button class="product-signout" type="button">Sign out</button></div></header><nav class="product-navigation" aria-label="${area === 'fleet' ? 'Panel' : 'Server'} navigation"></nav><div class="product-operation" role="status" aria-live="polite" hidden><span class="product-spinner" aria-hidden="true"></span><span></span></div><div class="product-feedback" role="status" aria-live="polite" hidden></div><dialog class="product-confirm" aria-labelledby="product-confirm-title"><form method="dialog"><p class="product-eyebrow">SERVER OPERATION</p><h2 id="product-confirm-title"></h2><p class="product-confirm-message"></p><div class="product-confirm-actions"><button value="cancel">Cancel</button><button class="product-confirm-yes" value="confirm">Continue</button></div></form></dialog>`;
  const existingSkip = document.querySelector('.skip-link');
  if (existingSkip) existingSkip.after(root);
  else {
    document.body.prepend(root);
    const main = document.querySelector('main');
    if (main) {
      main.id ||= 'product-content';
      main.tabIndex = -1;
      const skip = document.createElement('a');
      skip.className = 'product-skip';
      skip.href = '#' + main.id;
      skip.textContent = 'Skip to content';
      skip.addEventListener('click', (event) => {
        event.preventDefault();
        main.focus();
      });
      document.body.prepend(skip);
    }
  }
  document.body.dataset.productShell = area;
  const find = (selector) => root.querySelector(selector);
  const scoped = serverPath('/') !== '/';
  find('.product-brand').href =
    area === 'fleet' || scoped ? '/' : pagePath('#overview');
  find('.product-back').href = '/';
  find('.product-back').hidden = !scoped;
  find('.product-context-label').textContent =
    area === 'fleet' ? 'YOUR PANEL' : game + ' SERVER';
  find('.product-context-name').textContent =
    area === 'fleet' ? 'Your servers' : game;
  find('.product-signout').addEventListener('click', onLogout);
  const links = navigation.map((item) => {
    const link = document.createElement('a');
    link.href = pagePath('#' + item.id);
    link.textContent = item.label;
    link.dataset.shellPage = item.id;
    find('.product-navigation').append(link);
    return {item, link};
  });
  let timer,
    confirming = false;
  return {
    session(user) {
      root.hidden = !user;
      document.body.dataset.productSession = user ? 'signed-in' : 'signed-out';
      find('.product-user').textContent = user
        ? user.username +
          ' · ' +
          (user.role === 'admin' ? 'Administrator' : 'Read-only')
        : '';
      const guided =
        typeof onboarding === 'function' ? onboarding() : onboarding;
      find('.product-navigation').hidden =
        guided &&
        !!user &&
        user.role === 'admin' &&
        user.onboarding?.completed === false;
      for (const {item, link} of links)
        link.hidden = !!item.adminOnly && user?.role !== 'admin';
      if (!user) {
        clearTimeout(timer);
        find('.product-feedback').hidden = true;
        find('.product-operation').hidden = true;
      }
    },
    active(page) {
      for (const {item, link} of links)
        if (item.id === page) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    },
    attention(page, message = '') {
      const entry = links.find(({item}) => item.id === page);
      if (!entry) return;
      entry.link.dataset.attention = String(!!message);
      entry.link.title = message;
      entry.link.setAttribute(
        'aria-label',
        message ? entry.item.label + ': ' + message : entry.item.label,
      );
    },
    status(value) {
      const state =
          area === 'fleet' && value
            ? {
                label: value.ready ? 'Connected' : 'Host unavailable',
                state: value.ready ? 'ready' : 'attention',
              }
            : serverState(value),
        badge = find('.product-status');
      badge.textContent = state.label;
      badge.dataset.state = state.state;
      if (value?.name) find('.product-context-name').textContent = value.name;
      this.operation(value?.activeJob);
    },
    operation(job) {
      const node = find('.product-operation');
      node.hidden = !job || !['running', 'queued'].includes(job.state);
      node.lastElementChild.textContent = job?.message || 'Working…';
    },
    notify(message, {error = false, timeout = error ? 10000 : 6500} = {}) {
      const node = find('.product-feedback');
      if (!message && node.dataset.error !== String(error)) return;
      clearTimeout(timer);
      node.textContent = message;
      node.hidden = !message;
      node.dataset.error = String(error);
      node.setAttribute('role', error ? 'alert' : 'status');
      if (message && timeout)
        timer = setTimeout(() => {
          node.hidden = true;
        }, timeout);
    },
    async confirm(title, message, label = 'Continue') {
      if (confirming) return false;
      confirming = true;
      const dialog = find('.product-confirm');
      find('#product-confirm-title').textContent = title;
      find('.product-confirm-message').textContent = message;
      find('.product-confirm-yes').textContent = label;
      dialog.returnValue = 'cancel';
      dialog.showModal();
      try {
        return await new Promise((resolve) =>
          dialog.addEventListener(
            'close',
            () => resolve(dialog.returnValue === 'confirm'),
            {once: true},
          ),
        );
      } finally {
        confirming = false;
      }
    },
  };
}
