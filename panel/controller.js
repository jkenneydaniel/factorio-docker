// Stable entrypoint for existing installations.
import {startController} from './core/controller.js';
import {selectedGame} from './games/index.js';
await startController(selectedGame(process.env.GAME_MODULE||'factorio'));
