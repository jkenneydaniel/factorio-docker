// A presentation has top-level navigation and optional fixed child sections.
// Extensions may declare their own bounded subpaths without registering copies
// of the same controller (for example a world's create/import/result stages).
/** @param {import('./contracts.js').ApplicationPresentation} presentation @returns {import('./contracts.js').ApplicationRoute[]} */
export function applicationRoutes(presentation) {
  return presentation.screens.flatMap((screen) => [
    {id: screen.id, parent: screen, screen},
    ...(screen.routes || []).map((child) => ({
      id: screen.id + '/' + child.id,
      parent: screen,
      screen: child,
    })),
  ]);
}

/** @param {import('./contracts.js').ApplicationPresentation} presentation @param {string} hash @param {(screen:import('./contracts.js').ApplicationScreen,content?:boolean)=>boolean} allowed @returns {import('./contracts.js').ResolvedApplicationRoute|null} */
export function resolveApplicationRoute(presentation, hash, allowed) {
  const routes = applicationRoutes(presentation),
    permitted = routes.filter(
      (route) => allowed(route.parent) && allowed(route.screen, true),
    ),
    requested = hash.replace(/^#/, ''),
    exact = permitted.find((route) => route.id === requested);
  if (exact) return {...exact, path: requested};
  const group = requested.split('/')[0],
    base = permitted.find((route) => route.id === group);
  if (
    base &&
    base.screen.subroutes?.includes(requested.slice(group.length + 1))
  )
    return {...base, path: requested};
  // A delegated user may have access to a Settings child but not its general
  // configuration. Keep the section link useful without making a denied read.
  const child = permitted.find((route) => route.parent.id === requested);
  const fallback = child || permitted[0];
  return fallback ? {...fallback, path: fallback.id} : null;
}
