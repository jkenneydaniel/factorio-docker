// Shared browser transport; session cookies and server-side permissions stay unchanged.
export function createApi({
  base = '/api',
  getSession = () => null,
  onUnauthorized = () => {},
  fetcher = (...args) => fetch(...args),
} = {}) {
  return async function request(
    route,
    {method = 'GET', body, raw = false, signal} = {},
  ) {
    route = '/' + route.replace(/^\//, '');
    const headers = {};
    if (method !== 'GET') headers['x-csrf-token'] = getSession()?.csrf || '';
    if (body !== undefined && !raw)
      headers['content-type'] = 'application/json';
    const response = await fetcher(base + route, {
      method,
      credentials: 'same-origin',
      headers,
      signal,
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(
        'The panel returned an incomplete response. Check the connection and try again.',
      );
    }
    if (!response.ok) {
      if (
        response.status === 401 &&
        !['/login', '/register', '/registration'].includes(route)
      )
        onUnauthorized();
      throw Object.assign(
        new Error(result.error || 'The request could not be completed.'),
        {status: response.status},
      );
    }
    return result;
  };
}

export const playerCount = (value) =>
  Array.isArray(value) ? value.length : Number.isFinite(value) ? value : null;
export function sameImageReference(from, to) {
  if (typeof from !== 'string' || typeof to !== 'string') return false;
  const [a, ad] = from.split('@'),
    [b, bd] = to.split('@');
  return a === b && (!ad || !bd || ad === bd);
}
export function serverState(value) {
  if (!value) return {label: 'Unavailable', state: 'attention'};
  if (value.imageMigration)
    return {label: 'Needs attention', state: 'attention'};
  if (value.ready)
    return {label: value.paused ? 'Paused' : 'Ready', state: 'ready'};
  if (value.running) return {label: 'Starting', state: 'starting'};
  return {label: 'Stopped', state: 'stopped'};
}

// A slow request must not cause several overlapping refreshes of the same view.
export function pollEvery(work, delay) {
  let running = false;
  return setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await work();
    } finally {
      running = false;
    }
  }, delay);
}
