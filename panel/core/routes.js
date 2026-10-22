// One source of controller route exposure for web, local fleet and remote agents.
export const sharedControllerRoutes = Object.freeze([
  '/status',
  '/diagnostics',
  '/backups',
  '/jobs',
  '/download',
  '/schedule',
  '/backup-retention',
  '/update-status',
  '/update-plan',
  '/update-install',
]);
export const controllerRoutes = (module) => [
  ...new Set([...sharedControllerRoutes, ...module.routes]),
];
