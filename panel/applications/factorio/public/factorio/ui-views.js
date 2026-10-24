import {fragment, iconNode, part, text} from '../shared/templates.js';

export function createUiViews(getState, ui) {
  const {template} = ui;
  function heading(eyebrow, title, description, actions = null) {
    const view = template('heading');
    text(view, '[data-part=eyebrow]', eyebrow);
    text(view, 'h1', title);
    text(view, 'p', description);
    if (actions) part(view, '.button-group').append(actions);
    return view;
  }
  function readonly() {
    const {admin, user} = getState();
    if (admin()) return fragment();
    const view = template('readonly');
    text(
      view,
      '.readonly-note',
      user?.role === 'member'
        ? 'Your access is limited to the tools assigned by an administrator.'
        : 'You’re signed in with read-only access. An administrator can change settings and manage worlds.',
    );
    return view;
  }
  function jobBanner() {
    const {status, busyJob} = getState();
    if (status?.imageMigration) {
      const view = template('warning');
      text(view, '.warning', status.imageMigration.message);
      return view;
    }
    const job = busyJob || status?.activeJob;
    if (!job || !['running', 'queued'].includes(job.state)) return fragment();
    const view = template('job-banner');
    text(view, '[data-part=message]', job.message || 'Working…');
    return view;
  }
  function card(title, body, link = null) {
    const view = template('card');
    text(view, 'h2', title);
    part(view, '.card-body').append(body);
    if (link) part(view, '[data-part=link]').append(link);
    return view;
  }
  function empty(title, description = '') {
    const view = template('empty');
    text(view, '[data-part=title]', title);
    if (description) text(view, 'p', description);
    else part(view, 'p').remove();
    return view;
  }
  function actionButton(label, action, primary = false) {
    const {status, busyJob, recoveryRequired, updateState, canAction} =
      getState();
    const glyph =
      {
        save: 'device-floppy',
        restart: 'refresh',
        start: 'player-play',
        stop: 'player-stop',
        backup: 'database',
        'refresh-map': 'refresh',
      }[action] || 'adjustments';
    const view = template('action'),
      button = part(view, 'button');
    button.dataset.action = action;
    button.classList.toggle('primary', primary);
    button.disabled = !!(
      !canAction(action) ||
      recoveryRequired ||
      busyJob ||
      updateState?.busy ||
      status?.imageMigration
    );
    part(view, '[data-part=icon]').append(iconNode(glyph));
    text(view, '[data-part=label]', label.replace(/^[^A-Za-z]+/, ''));
    return view;
  }
  return {heading, readonly, jobBanner, card, empty, actionButton};
}
