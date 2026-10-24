import http from 'node:http';
import {AgentConnection} from './fleet/agent-connection.js';
import {readAgentIdentity} from './fleet/agent-identity.js';

let connection;
try{
 const port=process.env.PORT||8080;let response;
 if(process.env.MODE==='docker-broker'){
  response=await new Promise((resolve,reject)=>{const request=http.get({socketPath:(process.env.BROKER_TRANSPORT||'/broker-transport')+'/socket/docker.sock',path:'/health'},result=>{result.resume();resolve({ok:result.statusCode===200});});request.setTimeout(4000,()=>request.destroy(Error('Broker health timeout')));request.on('error',reject);});
 }else if(process.env.MODE==='host-agent-web'&&process.env.AGENT_TRANSPORT==='persistent'){
  const {fingerprint}=await readAgentIdentity(process.env.FLEET_WEB_ROOT||'/web-state');
  connection=new AgentConnection('https://127.0.0.1:'+port,fingerprint);
  response=await connection.fetch('https://127.0.0.1:'+port+'/health',{signal:AbortSignal.timeout(4000)});
 }else response=await fetch('http://127.0.0.1:'+port+'/health',{signal:AbortSignal.timeout(4000)});
 if(!response.ok)process.exitCode=1;await response.body?.cancel();
}catch{process.exitCode=1;}finally{connection?.close();}
