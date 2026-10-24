// One source of controller route exposure for web, local fleet and remote agents.
export const sharedControllerEndpoints = Object.freeze({
  '/status': {GET: 'viewer'},
  '/capabilities': {GET: 'viewer'},
  '/audit': {GET:'admin'},
  '/diagnostics': {GET: 'admin'},
  '/backups': {GET: 'viewer'},
  '/operations': {GET:'admin'},
  '/operations/recovery': {POST:'admin'},
  '/jobs': {GET: 'viewer', POST: 'admin'},
  '/jobs/recovery': {POST: 'admin'},
  '/download': {GET: 'admin'},
  '/schedule': {POST: 'admin'},
  '/backup-retention': {POST: 'admin'},
  '/update-status': {GET: 'admin'},
  '/update-plan': {POST: 'admin'},
  '/update-install': {POST: 'admin'},
});
export const sharedControllerRoutes = Object.freeze(
  Object.keys(sharedControllerEndpoints),
);
export const controllerAccess = (module, method, route) => {
  const reserved=sharedControllerEndpoints[route]?.[method];
  return reserved==='admin'?'admin':module.contract?.routes?.[route]?.[method]||reserved||null;
};
export const controllerRoutes = (module) => [
  ...new Set([...sharedControllerRoutes, ...module.routes]),
];
