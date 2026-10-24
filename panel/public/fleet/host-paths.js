/** @param {{local:boolean,id:string}} host @param {string} route */
export const hostRoute = (host, route) =>
  host.local ? route : '/hosts/' + host.id + route;
/** @param {{id:string,hostId?:string}} server */
export const serverKey = (server) => server.hostId + ':' + server.id;
