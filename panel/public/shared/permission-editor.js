import {escapeHTML as esc} from './view.js';

export function mountPermissionEditor(
  root,
  {request, confirm, notify, reload},
) {
  const abort = new AbortController();
  let version = 0;
  return {
    async load(users) {
      const current = ++version,
        members = users.filter((user) => user.role === 'member');
      if (!members.length) {
        root.innerHTML =
          '<p>Create an invitation with assigned-server access to delegate specific server tools. Existing administrator and read-only accounts keep their current access.</p>';
        return;
      }
      const [catalog, choices] = await Promise.all([
        request('/access-policy', {signal: abort.signal}),
        request('/access-resources', {signal: abort.signal}),
      ]);
      if (abort.signal.aborted || current !== version) return;
      const resources = new Map(
        choices.resources.map((resource) => [resource.id, resource]),
      );
      for (const member of members)
        for (const scope of Object.keys(member.grants || {})) {
          if (!resources.has(scope))
            resources.set(scope, {
              id: scope,
              name: 'Unavailable server · ' + scope,
            });
        }
      const serverChoices = [...resources.values()];
      root.innerHTML = `<form data-assignments><label>Account<select name="username">${members.map((user) => `<option>${esc(user.username)}</option>`).join('')}</select></label><label>Server<select name="scope">${serverChoices.map((resource) => `<option value="${esc(resource.id)}">${esc(resource.name)}</option>`).join('')}</select></label><fieldset><legend>Permitted tools</legend>${Object.entries(
        catalog.permissions,
      )
        .map(
          ([permission, label]) =>
            `<label class="check-label"><input type="checkbox" name="permission" value="${esc(permission)}">${esc(label)}</label>`,
        )
        .join(
          '',
        )}</fieldset><p>Include viewing access for every assignment. Full backup downloads may contain private server data. Executable mods and game image changes require their own explicit permissions. Mod download credentials, panel software updates, host administration and account administration remain administrator-only.</p><button ${serverChoices.length ? '' : 'disabled'}>Save server access</button><button type="button" data-remove-assignment ${serverChoices.length ? '' : 'disabled'}>Remove this assignment</button><div data-assigned-summary></div></form>`;
      const form = root.querySelector('form'),
        selected = () =>
          members.find(
            (user) => user.username === form.elements.username.value,
          );
      const show = () => {
        const user = selected(),
          permissions = user.grants?.[form.elements.scope.value] || [];
        form
          .querySelectorAll('[name=permission]')
          .forEach(
            (input) => (input.checked = permissions.includes(input.value)),
          );
        root.querySelector('[data-assigned-summary]').textContent =
          Object.keys(user.grants || {}).length +
          ' server assignment(s). Changes invalidate existing sessions; sign in again to refresh available tools.';
      };
      form.elements.username.addEventListener('change', show);
      form.elements.scope.addEventListener('change', show);
      show();
      async function save(remove = false) {
        if (
          !(await confirm(
            'Change server access?',
            'This changes the selected account’s server permissions immediately and signs out its existing sessions.',
          ))
        )
          return;
        const user = selected(),
          grants = {...user.grants};
        if (remove) delete grants[form.elements.scope.value];
        else
          grants[form.elements.scope.value] = [
            ...form.querySelectorAll('[name=permission]:checked'),
          ].map((input) => input.value);
        form
          .querySelectorAll('button')
          .forEach((button) => (button.disabled = true));
        try {
          await request('/accounts', {
            method: 'POST',
            body: {
              username: user.username,
              operation: 'grants',
              grants,
              revision: user.accessRevision || 0,
              confirm: true,
            },
            signal: abort.signal,
          });
          await reload();
          notify('Server access updated.');
        } catch (error) {
          if (!abort.signal.aborted) notify(error.message, true);
        } finally {
          form
            .querySelectorAll('button')
            .forEach((button) => (button.disabled = false));
        }
      }
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        void save();
      });
      form
        .querySelector('[data-remove-assignment]')
        .addEventListener('click', () => void save(true));
    },
    dispose() {
      version++;
      abort.abort();
    },
  };
}
