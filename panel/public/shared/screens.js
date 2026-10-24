/** @typedef {import('./contracts.js').ScreenContext} ScreenContext */
/** @typedef {import('./contracts.js').Screen} Screen */
/** @typedef {import('./contracts.js').ScreenRouterOptions} ScreenRouterOptions */

/**
 * One owner per active screen. Requests, confirmations and listeners expire with
 * that activation; a late response cannot paint or submit into another screen.
 * Controllers retain their own drafts until reset (session loss/sign-out).
 * @param {ScreenRouterOptions} options
 */
export function createScreenRouter({
  factories,
  root,
  request,
  prepare = async () => {},
  confirm = async () => false,
  onChange = () => {},
  onError = () => {},
}) {
  /** @type {Map<string,Screen>} */
  const instances = new Map();
  /** @type {{id:string,route:string,screen:Screen,context:ScreenContext,abort:AbortController,mounted:boolean,dispose():void,ready:Promise<void>,refreshing:Promise<void>|null}|null} */
  let active = null;
  let navigation = 0;
  function release() {
    const previous = active;
    active = null;
    if (!previous) return;
    previous.abort.abort();
    previous.dispose();
    previous.screen.dispose?.();
  }
  /** @param {unknown} error @param {AbortSignal} signal @param {'event'|'load'} [phase] */
  function report(error, signal, phase = 'load') {
    if (!signal.aborted)
      onError(error instanceof Error ? error : new Error(String(error)), phase);
  }
  return {
    get current() {
      return active?.id ?? null;
    },
    /** @param {string} id @param {Record<string,unknown>} [options] */
    async open(id, options = {}) {
      if (!Object.hasOwn(factories, id))
        throw new Error('Unknown screen: ' + id);
      const attempt = ++navigation;
      const route = typeof options.route === 'string' ? options.route : '';
      if (active?.id === id && active.route === route) {
        await this.refresh(options);
        return true;
      }
      if (
        (await active?.screen.beforeLeave?.()) === false ||
        attempt !== navigation
      )
        return false;
      release();
      const abort = new AbortController(),
        element = root(id);
      let bindings = new AbortController();
      /** @type {Array<()=>void>} */
      const disposers = [];
      const screen = instances.get(id) ?? factories[id]();
      instances.set(id, screen);
      /** @type {ScreenContext} */
      const context = {
        root: element,
        signal: abort.signal,
        isCurrent: () => active?.context === context && !abort.signal.aborted,
        async request(route, options = {}) {
          abort.signal.throwIfAborted();
          const signal = options.signal
            ? AbortSignal.any([abort.signal, options.signal])
            : abort.signal;
          const result = await request(route, {...options, signal});
          signal.throwIfAborted();
          return result;
        },
        async confirm(title, message, label) {
          if (!context.isCurrent()) return false;
          const accepted = await confirm(title, message, label);
          return context.isCurrent() && accepted;
        },
        render(html) {
          if (!context.isCurrent()) return;
          bindings.abort();
          bindings = new AbortController();
          if (typeof html === 'string') element.innerHTML = html;
          else element.replaceChildren(html);
        },
        on(target, type, listener) {
          target.addEventListener(
            type,
            (event) => {
              if (!context.isCurrent()) return;
              try {
                void Promise.resolve(listener(event)).catch((error) =>
                  report(error, abort.signal, 'event'),
                );
              } catch (error) {
                report(error, abort.signal, 'event');
              }
            },
            {signal: AbortSignal.any([abort.signal, bindings.signal])},
          );
        },
        onDispose(dispose) {
          disposers.push(dispose);
        },
      };
      const activation = {
        id,
        route,
        screen,
        context,
        abort,
        mounted: false,
        refreshing: /** @type {Promise<void>|null} */ (null),
        ready: Promise.resolve(),
        dispose() {
          bindings.abort();
          for (const dispose of disposers.splice(0)) dispose();
        },
      };
      active = activation;
      onChange(id);
      activation.ready = Promise.resolve()
        .then(async () => {
          await prepare(context, options);
          if (context.isCurrent()) {
            await screen.mount(context, options);
            activation.mounted = context.isCurrent();
          }
        })
        .catch((error) => report(error, abort.signal));
      await activation.ready;
      return context.isCurrent();
    },
    /** @param {Record<string,unknown>} [options] @returns {Promise<void>} */
    async refresh(options = {}) {
      const activation = active;
      if (!activation) return;
      await activation.ready;
      if (!activation.context.isCurrent()) return;
      if (activation.refreshing) {
        // Completion/reload carries new state. It must not disappear behind a
        // lightweight status refresh already in flight.
        if (options.reason && options.reason !== 'status') {
          await activation.refreshing;
          if (activation.context.isCurrent()) return this.refresh(options);
          return;
        }
        return activation.refreshing;
      }
      const refresh = activation.mounted
        ? (activation.screen.refresh ?? activation.screen.mount)
        : activation.screen.mount;
      activation.refreshing = Promise.resolve()
        .then(async () => {
          if (options.reason !== 'status')
            await prepare(activation.context, options);
          if (activation.context.isCurrent()) {
            await refresh.call(activation.screen, activation.context, options);
            activation.mounted = activation.context.isCurrent();
          }
        })
        .catch((error) => report(error, activation.abort.signal));
      try {
        await activation.refreshing;
      } finally {
        activation.refreshing = null;
      }
    },
    reset() {
      navigation++;
      release();
      instances.clear();
    },
  };
}
