// Stable entrypoint; fleet mode is opt-in and never adopts standalone resources.
let started;
if (process.env.MODE === 'docker-broker') {
  const {startDockerBroker} = await import('./core/docker-broker.js');
  started = await startDockerBroker();
} else if (process.env.MODE === 'fleet-controller') {
  const {startFleetController} = await import('./fleet/controller.js');
  started = await startFleetController();
} else if (process.env.MODE === 'host-agent-web') {
  const {startHostAgentWeb} = await import('./fleet/agent-web.js');
  started = await startHostAgentWeb();
} else if (process.env.MODE === 'fleet-web') {
  const {startFleetWeb} = await import('./fleet/web.js');
  started = await startFleetWeb();
} else {
  const {selectedApplication} = await import('./applications/index.js');
  const application = selectedApplication(process.env.GAME_MODULE || 'factorio');
  if (process.env.MODE === 'controller') {
    const {startController} = await import('./core/controller.js');
    started = await startController(application);
  } else {
    const {startWeb} = await import('./core/web.js');
    started = await startWeb(application);
  }
}

// Node is PID 1 in the runtime. Close management listeners and their registered
// cleanup hooks when Docker stops it; no application Stop action is submitted.
const server = started.server || started;
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  server.closeAllConnections?.();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
