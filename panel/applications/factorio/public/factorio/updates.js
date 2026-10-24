import {bindGameUpdate} from '../game-update.js';

export function createUpdateWorkflow({
  getState,
  request: api,
  shell,
  notify: toast,
  releaseView,
}) {
  const $ = (selector) => document.querySelector(selector);
  let generation = 0;
  let panelRelease = null,
    lastReleasePoll = 0,
    updateState = null,
    updateReviewPending = false,
    releaseChecking = false,
    context = null,
    controls = new AbortController();
  function refreshReleaseView() {
    const {currentPage} = getState();
    if (!context?.isCurrent()) return;
    if (
      currentPage !== 'settings' ||
      location.hash !== '#settings/updates' ||
      updateReviewPending ||
      $('#game-update-form')?.contains(document.activeElement) ||
      document.querySelector('dialog[open]')
    )
      return;
    const section = $('#panel-updates');
    if (section) {
      section.replaceWith(releaseView());
      bindUpdates();
    }
  }
  async function refreshUpdates() {
    const {can, user} = getState();
    if (!can('images.change')) return;
    const signedUser = user;
    try {
      const result = await api('/update-status');
      if (getState().user !== signedUser) return;
      const changed = JSON.stringify(result) !== JSON.stringify(updateState);
      updateState = result;
      if (changed) refreshReleaseView();
    } catch {}
  }
  function bindUpdates(ctx = context) {
    if (!ctx?.isCurrent()) return;
    context = ctx;
    controls.abort();
    controls = new AbortController();
    const {status} = getState();
    const listen = (element, type, listener) =>
      element?.addEventListener(type, listener, {
        signal: AbortSignal.any([ctx.signal, controls.signal]),
      });
    listen($('#check-panel-updates'), 'click', async () => {
      if (releaseChecking) return;
      releaseChecking = true;
      refreshReleaseView();
      try {
        await refreshReleases(true);
        if (panelRelease?.state !== 'unavailable')
          toast(
            'Release check complete. Repeated checks within one minute use the latest result.',
          );
      } catch (error) {
        if (ctx.isCurrent()) toast(error.message, true);
      } finally {
        releaseChecking = false;
        refreshReleaseView();
      }
    });
    async function review(kind, target, selection = {}) {
      if (updateReviewPending) return;
      updateReviewPending = true;
      const version = generation;
      try {
        const plan = await ctx.request('/update-plan', {
          method: 'POST',
          body: {kind, target, ...selection},
        });
        const message = `${plan.current} → ${plan.targetImage || plan.target}. ${plan.impact} ${plan.backup} ${plan.notes}`;
        if (
          await ctx.confirm(
            plan.operation === 'image-change'
              ? 'Change Factorio image?'
              : 'Install ' +
                  (kind === 'game' ? 'Factorio ' : 'Lobby Goblin ') +
                  plan.target +
                  '?',
            message,
            'Install update',
          )
        ) {
          await ctx.request('/update-install', {
            method: 'POST',
            body: {planId: plan.id, confirm: true},
          });
          toast(
            'Update started. The panel may reconnect; sign in again when it returns.',
          );
        }
      } catch (error) {
        if (ctx.isCurrent()) toast(error.message, true);
      } finally {
        if (version === generation && context === ctx) {
          updateReviewPending = false;
          await refreshUpdates();
        }
      }
    }
    listen($('#review-panel-update'), 'click', () =>
      review('panel', panelRelease.latest.tag.replace(/^v/, '')),
    );
    bindGameUpdate(status?.image, review, toast);
  }
  async function refreshReleases(force = false) {
    const {admin, user} = getState();
    if (!admin() || (!force && Date.now() - lastReleasePoll < 60000)) return;
    lastReleasePoll = Date.now();
    const signedUser = user;
    try {
      const result = await api(
        force ? '/updates/check' : '/updates',
        force ? {method: 'POST', body: {}} : {},
      );
      if (getState().user !== signedUser) return;
      const changed = JSON.stringify(result) !== JSON.stringify(panelRelease);
      panelRelease = result;
      shell.attention(
        'settings',
        result.available ? 'Panel update available' : '',
      );
      const notice = $('#release-notice');
      if (notice) {
        notice.hidden = !result.available;
        notice.textContent = result.latest
          ? 'Panel ' + result.latest.tag + ' available'
          : 'Panel update available';
      }
      if (changed) refreshReleaseView();
    } catch (error) {
      if (force) throw error;
    }
  }

  return {
    get model() {
      return {panelRelease, updateState, updateReviewPending, releaseChecking};
    },
    refreshUpdates,
    refreshReleases,
    bindUpdates,
    detach() {
      context = null;
      controls.abort();
    },
    reset() {
      generation++;
      context = null;
      controls.abort();
      panelRelease = null;
      lastReleasePoll = 0;
      updateState = null;
      updateReviewPending = false;
      releaseChecking = false;
    },
  };
}
