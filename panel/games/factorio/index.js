import {modLibraryRoutes} from '../../core/mod-library.js';
import path from 'node:path';
import {createFactorio} from './controller.js';
import {UpdateManager} from './update-manager.js';
import {controllerDiagnostics} from '../../diagnostics.js';
import {web} from './web.js';

export const factorio={
  id:'factorio',name:'Factorio',releaseRepository:'jkenneydaniel/lobby-goblin',stopTimeout:120,
  routes:[...modLibraryRoutes,'/worlds','/settings','/logs','/download','/preview','/upload','/map','/map-status','/live-players','/pins','/world-options','/world-preview','/world-preview-image'],
  configuration(env){
    const backups=env.BACKUPS_DIR||'/backups';
    return {data:env.FACTORIO_DATA||'/factorio',backups,state:env.STATE_DIR||'/state',container:env.FACTORIO_CONTAINER||'factorio-server',library:path.join(backups,'panel-worlds'),backupDir:path.join(backups,'panel-backups')};
  },
  createController:createFactorio,
  createUpdater:({env,...options})=>new UpdateManager({
    ...options,root:env.UPDATE_STATE_DIR||'/updates',repository:env.RELEASE_REPOSITORY||'jkenneydaniel/lobby-goblin',channel:env.RELEASE_CHANNEL||'preview',
    names:{game:env.FACTORIO_CONTAINER||'factorio-server',controller:env.CONTROLLER_CONTAINER||'factorio-panel-controller',panel:env.PANEL_CONTAINER||'factorio-panel'},
  }),
  diagnostics:controllerDiagnostics,
  web,
};
