import {createRustMods} from './mods-page.js';
import {serverPath} from '../scope.js';

// Rich Rust tools are one optional capability. The shared application owns all
// ordinary screens, authentication, navigation and operation presentation.
export const rustMods = {
  version: 1,
  create({getStatus, getSession, busy, can, canAction, job, notify}) {
    let workflow;
    return {
      async mount(ctx) {
        const response = await fetch(serverPath('/rust/mods.html'), {
          signal: ctx.signal,
        });
        if (!response.ok) throw Error('Rust mod tools could not be loaded.');
        const template = await response.text();
        if (!ctx.isCurrent()) return;
        ctx.render(template);
        workflow = createRustMods({
          root: ctx.root,
          api: (route, body) =>
            ctx.request(
              '/' + route.replace(/^\//, ''),
              body === undefined ? {} : {method: 'POST', body},
            ),
          job: (...args) => (ctx.isCurrent() ? job(...args) : undefined),
          getStatus,
          canAction,
          busy: () => !can('mods.manage') || busy(),
          manageAccount: () => getSession()?.role === 'admin',
          confirm: ctx.confirm,
          guarded: async (work) => {
            try {
              await work();
            } catch (error) {
              if (ctx.isCurrent()) notify(error.message, true);
            }
          },
        });
        await workflow.load();
      },
      async refresh(_ctx, options) {
        if (options.reason === 'status') workflow.setBusy();
        else await workflow.load();
      },
      dispose() {
        workflow?.dispose();
        workflow = null;
      },
    };
  },
};
