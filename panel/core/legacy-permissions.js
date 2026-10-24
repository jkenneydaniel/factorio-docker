// Compatibility for callers without a module. Production web services always
// supply the checked module contract; new game actions do not belong here.
export const actionPermissions = Object.freeze({
  start:'server.operate',stop:'server.operate',restart:'server.operate',save:'server.operate',announce:'server.operate',
  backup:'backups.create','verify-backup':'backups.create','cleanup-backups':'backups.cleanup',restore:'backups.restore',
  create:'worlds.manage',switch:'worlds.manage','world-options':'worlds.manage','refresh-map':'worlds.manage','live-tracking':'worlds.manage',
  settings:'settings.write','save-settings':'settings.write',player:'players.manage',console:'console.execute',
  'mod-library-install':'mods.manage','mod-library-recover':'mods.manage','install-framework':'mods.manage','recover-framework':'mods.manage',plugin:'mods.manage','plugin-config':'mods.manage',
});
export const actionPermission = action => Object.hasOwn(actionPermissions,action)?actionPermissions[action]:null;
export function legacyRoutePermission(method,route,{action,kind}={}) {
  if(method==='GET') {
    if(['/status','/capabilities','/worlds','/map','/map-status','/preview','/live-players','/players','/jobs'].includes(route))return 'server.view';
    if(route==='/logs')return 'logs.read';
    if(route==='/settings')return 'settings.read';
    if(['/mod-library','/mods','/plugin-config'].includes(route))return 'mods.manage';
    if(route==='/update-status')return 'images.change';
    if(route==='/backups')return 'backups.read';
    if(route==='/download')return kind==='backup'?'backups.download':'worlds.download';
    if(['/world-options','/world-preview','/world-preview-image'].includes(route))return 'worlds.manage';
  }
  if(method==='POST') {
    if(route==='/jobs')return actionPermission(action);
    if(route==='/schedule')return 'backups.schedule';
    if(['/mod-library-plan','/mods-plan'].includes(route))return 'mods.manage';
    if(['/update-plan','/update-install'].includes(route))return 'images.change';
    if(route==='/backup-retention')return 'backups.cleanup';
    if(['/upload','/world-preview','/pins'].includes(route))return 'worlds.manage';
  }
  // Installation/account/provider-credential administration, general operation
  // recovery and unknown module actions remain administrator-only.
  return null;
}
