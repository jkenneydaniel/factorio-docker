import {iconNode, part, text} from './shared/templates.js';
export function setupReady(s) {
  return !!(s?.ready && s.currentWorld && s.saveVerified && !s.activeJob);
}
export function setupPage(s, user, template) {
  const ready = setupReady(s),
    version = s.version.match(/\d+\.\d+\.\d+/)?.[0] || s.version;
  const view = template('setup');
  text(
    view,
    '.setup-heading h1',
    ready ? 'You’re ready to build.' : 'A few moments from your factory.',
  );
  text(
    view,
    '.setup-heading p',
    ready
      ? 'Your server is ready. Here’s how to join your first world.'
      : 'Keep this page open while your server gets ready. Your setup progress is saved.',
  );
  const row = (name, detail, ok) => {
    const item = template('readiness-row');
    part(item, '[data-part=icon]').append(
      iconNode(ok ? 'circle-check' : 'clock'),
    );
    text(item, 'strong', name);
    text(item, 'p', detail);
    text(item, '.mini-pill', ok ? 'Ready' : 'Waiting');
    part(item, '.mini-pill').classList.toggle('pending', !ok);
    return item;
  };
  part(view, '[data-part=readiness]').append(
    row(
      'Panel ready',
      'Signed in as ' + user.username + ' · Administrator',
      true,
    ),
    row(
      'Factorio ' + (s.ready ? 'ready' : s.running ? 'starting' : 'stopped'),
      (s.currentWorld?.replace(/\.zip$/, '') || 'No active world') +
        ' · Version ' +
        version,
      s.ready,
    ),
    row(
      'First save ' + (s.saveVerified ? 'ready' : 'waiting'),
      s.saveVerified
        ? 'Save completion confirmed by Factorio.'
        : 'Save once the game is ready to confirm your first save.',
      s.saveVerified,
    ),
  );
  if (s.saveVerified) part(view, '[data-part=save]').remove();
  else part(view, '[data-action=save]').disabled = !s.ready || !!s.activeJob;
  if (s.running) part(view, '[data-part=stopped]').remove();
  text(view, '[data-part=image]', s.image || 'Version pinned');
  text(view, '[data-part=autosave]', s.autosaveMinutes || 5);
  text(view, '[data-part=version]', version);
  text(view, '[data-part=connection]', s.connection);
  part(view, '[data-part=copy-address]').dataset.copy = s.connection;
  text(
    view,
    '[data-part=world]',
    s.currentWorld?.replace(/\.zip$/, '') || 'your world',
  );
  text(
    view,
    '[data-part=address-hint]',
    /^(localhost|127\.0\.0\.1|\[::1\])(?::|$)/i.test(s.connection)
      ? 'This game address works only on the Docker host. Set GAME_ADDRESS in your host configuration to its network address for other devices.'
      : 'Try joining from another device on your network to confirm LAN access. Local health checks cannot prove it.',
  );
  text(view, '[data-part=origin]', location.origin);
  part(view, '[data-part=copy-link]').dataset.copy = location.origin;
  text(
    view,
    '[data-part=panel-hint]',
    /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
      ? 'This link works on this computer. Other devices need this host’s network address and an allowed panel hostname.'
      : 'Other devices need network access to this address and an invitation to register.',
  );
  part(view, '#finish-setup').disabled = !ready;
  text(view, '.setup-finish a', ready ? 'Do this later' : 'Go to overview');
  text(
    view,
    '[data-part=waiting]',
    ready ? '' : 'Readiness checks refresh automatically.',
  );
  return view;
}
