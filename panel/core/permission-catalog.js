export const permissionCatalog = Object.freeze({
  'server.view': 'View server status, worlds, players and activity',
  'server.operate': 'Start, save, stop, restart and announce',
  'logs.read': 'Read server logs',
  'settings.read': 'Read game settings',
  'settings.write': 'Change game settings',
  'worlds.manage': 'Create, upload and switch worlds',
  'worlds.download': 'Download world saves',
  'players.manage': 'Manage player access',
  'console.execute': 'Run supported administrative commands',
  'mods.manage':
    'Install executable mods, frameworks and plugins; manage their configuration and recovery',
  'images.change':
    'Review and change the game image or version (where supported)',
  'backups.read': 'List backups and backup health',
  'backups.create': 'Create and verify backups',
  'backups.download': 'Download full backup archives',
  'backups.restore': 'Restore backups',
  'backups.schedule': 'Configure automatic backups',
  'backups.cleanup': 'Review and delete old backup archives',
});

export const validPermissionName = (value) =>
  typeof value === 'string' &&
  (Object.hasOwn(permissionCatalog, value) ||
    /^(?:game|application)\.[a-z][a-z0-9-]*\.[a-z][a-z0-9.-]{0,63}$/.test(
      value,
    ));
