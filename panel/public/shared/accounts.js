import {mountAuditHistory} from './audit-history.js';
import {mountPermissionEditor} from './permission-editor.js';
import {pagePath} from '../scope.js';
import {escapeHTML as esc, formatDate} from './view.js';

// Forms belong to this component rather than any game's page controller. Loads
// never replace an active draft; disposal prevents stale responses after navigation.
export function mountAccounts(
  root,
  {request, session, confirm, notify, onSignedOut, showHeading = true},
) {
  const abort = new AbortController();
  const read = (route) => request(route, {signal: abort.signal});
  const write = (route, body) =>
    request(route, {method: 'POST', body, signal: abort.signal});
  root.innerHTML = `<div class="product-workflow">${showHeading ? '<h1>Account and access</h1>' : ''}<p>Manage your sign-in, sessions and panel access.</p><div class="product-workflow-grid"><section class="product-card"><h2>Change password</h2><form data-password><label>Current password<input name="currentPassword" type="password" autocomplete="current-password" required></label><label>New password<input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label><label>Confirm new password<input name="confirmation" type="password" autocomplete="new-password" required></label><button>Change password</button></form></section><section class="product-card"><h2>Signed-in sessions</h2><div data-sessions></div><button type="button" data-other-sessions>Sign out other sessions</button></section></div><div data-admin-access hidden><div class="product-workflow-grid"><section class="product-card"><h2>Create an invitation</h2><form data-invite><label>Invitation role<select name="role"><option value="viewer">Read-only</option><option value="admin">Administrator</option><option value="member">Assigned servers</option></select></label><button>Create invitation</button></form><label data-invitation hidden>Private invitation link<input readonly></label></section><section class="product-card"><h2>Panel accounts</h2><div data-users></div></section></div><section class="product-card"><h2>Assigned-server permissions</h2><div data-server-access></div></section><section class="product-card"><h2>Unused invitations</h2><div data-invitations></div></section><section class="product-card"><h2>Audit history</h2><div data-audit-history></div></section></div></div>`;
  const find = (selector) => root.querySelector(selector);
  const auditHistory = mountAuditHistory(find('[data-audit-history]'), {
    request,
    notify,
  });
  const permissionEditor = mountPermissionEditor(find('[data-server-access]'), {
    request,
    confirm,
    notify,
    reload: () => loadAccess(),
  });
  const guard = async (element, work) => {
    element.disabled = true;
    try {
      await work();
    } catch (error) {
      if (!abort.signal.aborted) notify(error.message, true);
    } finally {
      element.disabled = false;
    }
  };
  async function loadSessions() {
    const value = await read('/sessions');
    if (abort.signal.aborted) return;
    find('[data-sessions]').innerHTML = value.sessions
      .map(
        (item) =>
          `<div class="product-row"><span>${item.current ? 'This session' : 'Another session'}<small>Signed in ${esc(formatDate(item.created))} · expires ${esc(formatDate(item.expires))}</small></span>${item.current ? '' : `<button data-session="${esc(item.id)}">Sign out</button>`}</div>`,
      )
      .join('');
  }
  async function loadAccess() {
    if (session.current?.role !== 'admin') return;
    const value = await read('/accounts');
    if (abort.signal.aborted) return;
    find('[data-admin-access]').hidden = false;
    find('[data-users]').innerHTML = value.users
      .map(
        (user) =>
          `<div class="product-row"><span>${esc(user.username)}<small>${user.role === 'admin' ? 'Administrator' : user.role === 'member' ? 'Assigned servers' : 'Read-only'}</small></span><span><button data-account="${esc(user.username)}" data-role="${user.role === 'admin' ? 'viewer' : 'admin'}">${user.role === 'admin' ? 'Make read-only' : 'Make administrator'}</button>${user.role !== 'member' ? `<button data-account="${esc(user.username)}" data-role="member">Make assigned-server</button>` : ''}<button data-delete="${esc(user.username)}">Remove</button></span></div>`,
      )
      .join('');
    await permissionEditor.load(value.users);
    find('[data-invitations]').innerHTML = value.invitations.length
      ? value.invitations
          .map(
            (item) =>
              `<div class="product-row"><span>${item.role === 'admin' ? 'Administrator' : item.role === 'member' ? 'Assigned servers' : 'Read-only'} · expires ${esc(formatDate(item.expires))}</span><button data-revoke="${esc(item.id)}">Revoke</button></div>`,
          )
          .join('')
      : '<p>No unused invitations.</p>';
  }
  find('[data-password]').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget,
      body = Object.fromEntries(new FormData(form));
    void guard(form.querySelector('button'), async () => {
      if (body.password !== body.confirmation)
        throw Error('The new passwords do not match.');
      await session.changePassword(body);
      form.reset();
      await loadSessions();
      notify('Password changed. Other sessions have been signed out.');
    });
  });
  find('[data-invite]').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    void guard(form.querySelector('button'), async () => {
      const value = await write(
        '/invitations',
        Object.fromEntries(new FormData(form)),
      );
      const box = find('[data-invitation]'),
        input = box.querySelector('input');
      box.hidden = false;
      input.value = location.origin + pagePath('#register=' + value.token);
      input.focus();
      input.select();
      await loadAccess();
    });
  });
  root.addEventListener(
    'click',
    (event) => {
      const button = event.target.closest(
        '[data-other-sessions],[data-session],[data-revoke],[data-account],[data-delete]',
      );
      if (!button || !root.contains(button)) return;
      void guard(button, async () => {
        if (
          button.hasAttribute('data-other-sessions') ||
          button.dataset.session
        ) {
          await write(
            '/sessions',
            button.dataset.session
              ? {id: button.dataset.session}
              : {others: true},
          );
          await loadSessions();
          notify('Sessions updated.');
        }
        if (
          button.dataset.revoke &&
          (await confirm(
            'Revoke this invitation?',
            'The registration link will stop working. Existing accounts keep their access.',
          ))
        ) {
          await write('/invitations', {revoke: button.dataset.revoke});
          await loadAccess();
          notify('Invitation revoked.');
        }
        const username = button.dataset.account || button.dataset.delete;
        if (
          username &&
          (await confirm(
            button.dataset.delete
              ? 'Remove ' + username + '?'
              : 'Change access for ' + username + '?',
            button.dataset.role === 'admin'
              ? 'Administrator access grants control of every host and server in this installation. This account will be signed out.'
              : 'This account will be signed out and the change will take effect immediately.',
          ))
        ) {
          await write('/accounts', {
            username,
            operation: button.dataset.delete ? 'delete' : 'role',
            ...(button.dataset.role ? {role: button.dataset.role} : {}),
            confirm: true,
          });
          if (username === session.current?.username) {
            session.set(null);
            onSignedOut();
          } else {
            await loadAccess();
            notify('Account updated.');
          }
        }
      });
    },
    {signal: abort.signal},
  );
  return {
    load: () =>
      Promise.all([
        loadSessions(),
        loadAccess(),
        session.current?.role === 'admin' ? auditHistory.load() : null,
      ]),
    dispose: () => {
      permissionEditor.dispose();
      auditHistory.dispose();
      abort.abort();
    },
  };
}
