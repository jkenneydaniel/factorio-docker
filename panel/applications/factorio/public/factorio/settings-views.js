import {gameUpdateForm} from '../game-update.js';
import {fragment, iconNode, part, text} from '../shared/templates.js';

export function createSettingsViews(getState, ui) {
  const {template, date} = ui;
  function history(jobs, admin) {
    if (!jobs.length) {
      const view = template('update-history-empty');
      text(
        view,
        '[data-part=label]',
        admin ? 'No installations yet.' : 'No game installations yet.',
      );
      return view;
    }
    return fragment(
      ...jobs.slice(0, 8).map((job) => {
        const view = template('update-history-row');
        if (admin)
          part(view, '[data-part=icon]').append(
            iconNode(
              job.state === 'succeeded'
                ? 'circle-check'
                : job.state === 'failed'
                  ? 'alert-circle'
                  : 'refresh',
            ),
          );
        else part(view, '[data-part=icon]').remove();
        text(
          view,
          'strong',
          (job.kind === 'game' ? 'Factorio' : 'Panel') +
            ' ' +
            job.target +
            ' · ' +
            job.state,
        );
        text(view, '[role=status]', job.message);
        if (admin && job.targetImage) text(view, 'code', job.targetImage);
        else part(view, '[data-part=image]').remove();
        if (job.backup)
          text(view, '[data-part=backup]', 'Pre-update backup: ' + job.backup);
        else part(view, '[data-part=backup]').remove();
        if (job.recovery)
          text(
            view,
            '[data-part=recovery]',
            job.recovery.action +
              (admin
                ? ' Recovery copy: ' + job.recovery.directory
                : ' Ask an administrator to review recovery.'),
          );
        else part(view, '[data-part=recovery]').remove();
        text(view, 'time', date(job.finished || job.started));
        return view;
      }),
    );
  }
  function releaseView() {
    const {
      status,
      updateState,
      panelRelease: release,
      updateReviewPending,
      releaseChecking,
      admin,
      can,
    } = getState();
    if (!can('images.change')) return fragment();
    if (updateState?.supported === false) {
      const view = template('updates-unsupported');
      text(view, '[data-part=message]', updateState.message);
      return view;
    }
    const disabled = !!(
      updateState?.busy ||
      updateReviewPending ||
      !updateState
    );
    if (!admin()) {
      const view = template('updates-delegated');
      part(view, '[data-part=game-form]').append(
        gameUpdateForm(status.image, disabled, template),
      );
      part(view, '[data-part=history]').append(
        history(
          (updateState?.jobs || []).filter((job) => job.kind === 'game'),
          false,
        ),
      );
      return view;
    }
    const check = template('update-check');
    part(check, 'button').disabled =
      releaseChecking || release?.state === 'disabled';
    text(
      check,
      '[data-part=label]',
      releaseChecking ? 'Checking…' : 'Check for updates',
    );
    if (!release) {
      const view = template('updates-unavailable');
      part(view, '[data-part=check]').append(check);
      return view;
    }
    const view = template('updates');
    text(view, '[data-part=current]', release.current);
    if (release.available) {
      text(view, '[data-part=latest]', release.latest?.tag);
      part(view, '#review-panel-update').disabled = disabled;
    } else
      for (const selector of [
        '[data-part=arrow]',
        '[data-part=latest]',
        '[data-part=available]',
        '#review-panel-update',
      ])
        part(view, selector).remove();
    text(
      view,
      '[data-part=release-label]',
      {
        available: 'An update is available',
        current: 'Panel is up to date',
        'no-releases': 'No releases in this channel',
        disabled: 'Release checks are disabled',
        unavailable: 'Release check unavailable',
        unchecked: 'Release check pending',
      }[release.state] || 'Release status unavailable',
    );
    if (release.error) text(view, '[data-part=error]', release.error);
    else part(view, '[data-part=error]').remove();
    part(view, '[data-part=check]').append(check);
    const url = release.latest?.url;
    if (
      url &&
      /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\/tag\//.test(
        url,
      )
    )
      part(view, '[data-part=release-link]').href = url;
    else part(view, '[data-part=release-link]').remove();
    text(
      view,
      '[data-part=version]',
      status.version.match(/\d+\.\d+\.\d+/)?.[0] || status.version,
    );
    part(view, '[data-part=game-form]').append(
      gameUpdateForm(status.image, disabled, template),
    );
    text(
      view,
      '[data-part=channel]',
      release.channel === 'preview' ? 'Preview' : 'Stable',
    );
    text(
      view,
      '[data-part=channel-hint]',
      release.channel === 'preview'
        ? 'Includes alpha and beta releases.'
        : 'Stable releases only.',
    );
    text(view, '[data-part=checked]', date(release.checkedAt));
    text(
      view,
      '[data-part=checks]',
      release.state === 'disabled' ? 'Off' : 'Every 6 hours',
    );
    text(
      view,
      '[data-part=service-hint]',
      updateState
        ? 'Progress survives panel replacement. Sign in again to see the result.'
        : 'Update service is unavailable. Complete the updated host setup first.',
    );
    part(view, '[data-part=history]').append(
      history(updateState?.jobs || [], true),
    );
    return view;
  }
  return {releaseView};
}
