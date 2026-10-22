// Runs inside the built public image; no socket, network or installation mounts.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {startWeb} from '/app/core/web.js';
import {selectedGame} from '/app/games/index.js';
await fs.mkdir('/tmp/runtime-smoke/auth',{recursive:true});
await fs.writeFile('/tmp/runtime-smoke/token','disposable-runtime-smoke-token');
for(const game of ['factorio','rust']){
 const server=await startWeb(selectedGame(game),{env:{AUTH_DIR:'/tmp/runtime-smoke/auth',CONTROLLER_TOKEN_FILE:'/tmp/runtime-smoke/token',RELEASE_CHECKS:'false',PANEL_HOSTS:'127.0.0.1'},port:0,hostname:'127.0.0.1'});
 try{
  const origin='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(origin+'/health')).status,200);
  assert.match(await (await fetch(origin+'/')).text(),/Lobby Goblin/);
  for(const entry of ['core/controller.js','fleet/controller.js','fleet/worker.js','update-worker.js','games/rust/controller.js'])await fs.access('/app/'+entry);
 }finally{await new Promise(resolve=>server.close(resolve));}
}
console.log('Shared runtime serves both game panels and includes controller/worker entrypoints.');
