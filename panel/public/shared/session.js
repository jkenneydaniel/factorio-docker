// One session owner for every product area. Presentation and first-run guides
// remain with the entry point; cookies, CSRF and account APIs remain unchanged.
/**
 * @param {{request: import('./contracts.js').SessionRequest, onChange?: (value: import('./contracts.js').Session|null) => void}} options
 * @returns {import('./contracts.js').SessionController}
 */
export function createSessionController({request, onChange = () => {}}) {
  /** @type {import('./contracts.js').Session|null} */
  let current = null;
  /**
   * @template {import('./contracts.js').Session|null} T
   * @param {T} value
   * @returns {T}
   */
  const set = (value) => {
    current = value;
    onChange(value);
    return value;
  };
  return {
    get current() {
      return current;
    },
    set,
    async bootstrap({invitation = false} = {}) {
      if (invitation) return set(null);
      try {
        return set(await request('/session'));
      } catch {
        return set(null);
      }
    },
    async signIn(body) {
      return set(await request('/login', {method: 'POST', body}));
    },
    async register(body) {
      return set(await request('/register', {method: 'POST', body}));
    },
    async changePassword(body) {
      return set(await request('/password', {method: 'POST', body}));
    },
    async signOut() {
      await request('/logout', {method: 'POST', body: {}});
      set(null);
    },
  };
}
