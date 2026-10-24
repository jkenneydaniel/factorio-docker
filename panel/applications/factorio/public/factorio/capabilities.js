import {loadTemplates, fragment} from '../shared/templates.js';
import {createWorldsScreen} from './worlds-screen.js';
import {createMapScreen} from './map-screen.js';
import {createUiViews} from './ui-views.js';
import {createSettingsViews} from './settings-views.js';
import {createUpdateWorkflow} from './updates.js';
import {formatBytes as bytes} from '../shared/view.js';
import {setupPage, setupReady} from '../onboarding.js';
import {cleanWorldPreview} from '../world-preview.js';
import {
  clearWorldDraft,
  flushWorldDraft,
  saveWorldDraft,
  hasUnsavedDraft,
} from '../world-editor.js';

const pretty = (value) =>
  String(value || '')
    .replace(/\.zip$/, '')
    .replace(/[_-]/g, ' ');
const date = (value) =>
  value
    ? new Date(value).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'Not yet';

function featureContext(app, updateModel = () => ({})) {
  const getState = () => ({
    ...updateModel(),
    status: app.getStatus(),
    user: app.getSession(),
    busyJob:
      app.getOperation() ||
      app.getStatus()?.activeJob ||
      (app.busy()
        ? {state: 'running', message: 'An operation is in progress.'}
        : null),
    recoveryRequired: app.recoveryRequired(),
    currentPage: app.getRoute()?.split('/')[0],
    admin: () => app.getSession()?.role === 'admin',
    can: app.can,
    canAction: app.canAction,
  });
  let sharedTemplates, capabilityTemplates;
  const template = (name) => {
    try {
      return capabilityTemplates(name);
    } catch (error) {
      if (!error.message.startsWith('Unknown application template:'))
        throw error;
      return sharedTemplates(name);
    }
  };
  const helpers = {
    pretty,
    bytes,
    date,
    template,
  };
  return {
    getState,
    ui: {...helpers, ...createUiViews(getState, helpers)},
    async prepare(ctx, name) {
      const loaded = await Promise.all([
        loadTemplates('/factorio/capabilities.html', ctx.signal),
        loadTemplates('/factorio/' + name + '.html', ctx.signal),
      ]);
      ctx.signal.throwIfAborted();
      [sharedTemplates, capabilityTemplates] = loaded;
    },
  };
}
function bindCommon(ctx, app) {
  for (const button of ctx.root.querySelectorAll('[data-action]'))
    ctx.on(button, 'click', () =>
      app.job(button.dataset.action, {}, {wait: true}),
    );
  for (const button of ctx.root.querySelectorAll('[data-copy]'))
    ctx.on(button, 'click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        if (ctx.isCurrent()) app.notify('Copied.');
      } catch {
        if (ctx.isCurrent()) app.notify(button.dataset.copy);
      }
    });
  for (const button of ctx.root.querySelectorAll('[data-scroll-to]'))
    ctx.on(button, 'click', () => {
      const element = ctx.root.querySelector('#' + button.dataset.scrollTo);
      if (element) {
        const details = element.closest('details');
        if (details) details.open = true;
        (details || element).scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }
    });
}

// Specialized capabilities only. Sessions, navigation and ordinary screens are
// owned by the same application host that serves Rust and non-game packages.
export function createFactorioCapabilities() {
  let worlds = null,
    updates = null;
  return {
    'factorio.worlds': {
      version: 1,
      async beforeSignOut() {
        await saveWorldDraft();
        if (hasUnsavedDraft())
          throw Error(
            'Your world draft could not be saved. Download a draft copy before signing out.',
          );
      },
      onSessionEnd() {
        cleanWorldPreview();
        clearWorldDraft();
        worlds?.reset();
        worlds = null;
      },
      create(app) {
        const {getState, ui, prepare} = featureContext(app);
        const job = (action, params) =>
          app.job(action, params, {
            wait: true,
            onAccepted: () => app.reload(),
            onSettled: (job) =>
              job.state === 'succeeded'
                ? worlds.completed(action, params, job)
                : undefined,
          });
        worlds = createWorldsScreen({
          getState,
          ui,
          startJob: job,
          request: app.request,
          bindCommon: (ctx) => bindCommon(ctx, app),
          notify: app.notify,
        });
        return {
          async mount(ctx) {
            const previous = document.querySelector('#preview-dialog');
            if (previous) {
              previous.querySelector('img').onerror = null;
              previous.close();
              previous.remove();
            }
            await prepare(ctx, 'worlds');
            if (!ctx.isCurrent()) return;
            const fragment = ui.template('factorio-world-preview'),
              dialog = fragment.querySelector('dialog');
            document.body.append(fragment);
            dialog
              .querySelector('#close-preview')
              .addEventListener('click', () => dialog.close(), {
                signal: ctx.signal,
              });
            ctx.onDispose(() => {
              dialog.querySelector('img').onerror = null;
              dialog.close();
              dialog.remove();
            });
            await worlds.mount(ctx);
          },
          async beforeLeave() {
            await saveWorldDraft();
            if (hasUnsavedDraft()) {
              app.notify(
                'Your world draft has not been saved. Download a draft copy before leaving.',
                true,
              );
              return false;
            }
            await flushWorldDraft();
          },
          async refresh(ctx, reason) {
            if (reason.reason !== 'status') {
              await saveWorldDraft();
              if (hasUnsavedDraft()) {
                app.notify(
                  'Your world draft could not be saved. Download a draft copy before reloading.',
                  true,
                );
                return;
              }
              await flushWorldDraft();
              cleanWorldPreview();
            }
            await worlds.refresh(ctx, reason);
          },
          dispose() {
            cleanWorldPreview();
            worlds?.dispose();
          },
        };
      },
    },
    'factorio.map': {
      version: 1,
      create(app) {
        const {getState, ui, prepare} = featureContext(app);
        const screen = createMapScreen({
          getState,
          ui,
          startJob: (action, params) => app.job(action, params, {wait: true}),
          bindCommon: (ctx) => bindCommon(ctx, app),
          notify: app.notify,
        });
        return {
          ...screen,
          async mount(ctx, options) {
            await prepare(ctx, 'map');
            if (ctx.isCurrent()) await screen.mount(ctx, options);
          },
        };
      },
    },
    'factorio.setup': {
      version: 1,
      create(app) {
        const {getState, ui, prepare} = featureContext(app);
        function load(ctx) {
          ctx.render(
            fragment(
              ui.jobBanner(),
              setupPage(getState().status, getState().user, ui.template),
            ),
          );
          ctx.root.className = 'setup-page';
          bindCommon(ctx, app);
          const button = ctx.root.querySelector('#finish-setup');
          if (button)
            ctx.on(button, 'click', async () => {
              button.disabled = true;
              try {
                const onboarding = await ctx.request('/onboarding', {
                  method: 'POST',
                  body: {complete: true},
                });
                app.session.set({...app.getSession(), onboarding});
                location.hash = '#overview';
                app.notify('Setup complete. Welcome to your factory.');
              } finally {
                if (ctx.isCurrent())
                  button.disabled = !setupReady(app.getStatus());
              }
            });
        }
        return {
          async mount(ctx) {
            await prepare(ctx, 'setup');
            if (ctx.isCurrent()) load(ctx);
          },
          refresh(ctx, reason) {
            if (
              reason.reason !== 'status' ||
              (!app.busy() && !document.querySelector('dialog[open]'))
            )
              load(ctx);
          },
        };
      },
    },
    'factorio.updates': {
      version: 1,
      onSessionEnd() {
        updates?.reset();
        updates = null;
      },
      create(app) {
        let workflow;
        const {getState, ui, prepare} = featureContext(
            app,
            () => workflow?.model || {},
          ),
          {releaseView} = createSettingsViews(getState, ui);
        workflow = createUpdateWorkflow({
          getState,
          request: app.request,
          shell: {attention: app.attention},
          notify: app.notify,
          releaseView,
        });
        updates = workflow;
        return {
          async mount(ctx) {
            await prepare(ctx, 'updates');
            if (!ctx.isCurrent()) return;
            await workflow.refreshReleases();
            if (!ctx.isCurrent()) return;
            await workflow.refreshUpdates();
            ctx.render(releaseView());
            ctx.root.className = 'updates-page';
            workflow.bindUpdates(ctx);
          },
          async refresh(ctx, reason) {
            await workflow.refreshReleases();
            if (!ctx.isCurrent()) return;
            await workflow.refreshUpdates();
            if (reason.reason !== 'status' && ctx.isCurrent()) {
              ctx.render(releaseView());
              workflow.bindUpdates(ctx);
            }
          },
          dispose() {
            workflow.detach();
          },
        };
      },
    },
  };
}
