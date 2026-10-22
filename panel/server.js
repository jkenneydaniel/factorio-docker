// Stable entrypoint; fleet mode is opt-in and never adopts standalone resources.
if(process.env.MODE==='fleet-controller'){
 const {startFleetController}=await import('./fleet/controller.js');await startFleetController();
}else if(process.env.MODE==='host-agent-web'){
 const {startHostAgentWeb}=await import('./fleet/agent-web.js');await startHostAgentWeb();
}else if(process.env.MODE==='fleet-web'){
 const {startFleetWeb}=await import('./fleet/web.js');await startFleetWeb();
}else{
 const {selectedGame}=await import('./games/index.js');const game=selectedGame(process.env.GAME_MODULE||'factorio');
 if(process.env.MODE==='controller'){const {startController}=await import('./core/controller.js');await startController(game);}
 else{const {startWeb}=await import('./core/web.js');await startWeb(game);}
}
