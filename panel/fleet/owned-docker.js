// Stable import for existing managed controllers and integrations.
import {ownedDocker as scopedDocker} from '../core/owned-docker.js';
import {selectedGame} from '../games/index.js';
export function ownedDocker(request,env) {
  const module=selectedGame(env.GAME_MODULE||'factorio');
  return scopedDocker(request,env,{container:env.FACTORIO_CONTAINER||env.RUST_CONTAINER,...module.managed});
}
