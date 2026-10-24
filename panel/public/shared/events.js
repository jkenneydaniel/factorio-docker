/**
 * Owns replaceable handlers for persistent forms/dialogs. Unlike repeatedly
 * assigning onclick, disposal removes every handler and permits later rebinding.
 * @param {(error:Error)=>void} [onError]
 */
export function createEventScope(onError = () => {}) {
  /** @type {Map<EventTarget,Map<string,EventListener>>} */
  const targets = new Map();
  return {
    /** @param {EventTarget} target @param {string} type @param {(event:Event)=>void|Promise<void>} listener */
    set(target, type, listener) {
      let handlers = targets.get(target);
      if (!handlers) {
        handlers = new Map();
        targets.set(target, handlers);
      }
      const previous = handlers.get(type);
      if (previous) target.removeEventListener(type, previous);
      /** @param {unknown} error */
      const report = (error) => {
        if (targets.get(target)?.get(type) === handler)
          onError(error instanceof Error ? error : new Error(String(error)));
      };
      /** @type {EventListener} */
      const handler = (event) => {
        try {
          void Promise.resolve(listener(event)).catch(report);
        } catch (error) {
          report(error);
        }
      };
      handlers.set(type, handler);
      target.addEventListener(type, handler);
    },
    clear() {
      for (const [target, handlers] of targets)
        for (const [type, handler] of handlers)
          target.removeEventListener(type, handler);
      targets.clear();
    },
  };
}
