// Agent-only Compose document. All names derive from a fresh installation ID;
// game containers are provisioned later through FleetManager.
import {httpsGateway} from '../https.js';
export function hostAgentCompose(options,id){
 const image=options.image,project='lobby-goblin-fleet-'+id,labels=role=>({'io.lobby-goblin.fleet':id,'io.lobby-goblin.role':role});
 const security={user:'0:0',restart:'unless-stopped',cap_drop:['ALL'],security_opt:['no-new-privileges:true'],networks:['management'],logging:{driver:'json-file',options:{'max-size':'5m','max-file':'2'}}};
 const persistent=options.transport==='persistent';
 const {command,configs,definition}=persistent?{}:httpsGateway(options.domain,'host-agent:8080');
 const compose={name:project,services:{
  'fleet-controller':{...security,image,container_name:'lobby-goblin-host-'+id,mem_limit:'1g',cpus:1,labels:labels('host-controller'),environment:{MODE:'fleet-controller',PORT:'8091',FLEET_ID:id,FLEET_IMAGE:image,FLEET_HOST_CONTAINER:'lobby-goblin-host-'+id,FLEET_STATE_VOLUME:project+'-state',FLEET_LIBRARY_VOLUME:project+'-library',FLEET_PANEL_URL:options.origin,FLEET_GAME_ADDRESS:options.address,FLEET_GAME_BIND:'0.0.0.0',FLEET_MEMORY_GIB:String(options.memory),FLEET_GAME_PORT_BASE:'35000',FLEET_AGENT_ONLY:'true',...(persistent?{FLEET_AGENT_TRANSPORT:'persistent'}:{})},volumes:['/var/run/docker.sock:/var/run/docker.sock','fleet-state:/fleet','fleet-library:/library','fleet-web:/web-state']},
  'host-agent':{...security,image,container_name:'lobby-goblin-agent-'+id,read_only:true,mem_limit:'512m',cpus:0.5,tmpfs:['/tmp'],labels:labels('host-agent-web'),environment:{MODE:'host-agent-web',PORT:'8080',CONTROLLER_TOKEN_FILE:'/web-state/secrets/controller-token',CONTROLLER_URL:'http://fleet-controller:8091',PANEL_ORIGIN:options.origin,...(persistent?{AGENT_TRANSPORT:'persistent'}:{})},volumes:['fleet-web:/web-state:ro'],depends_on:{'fleet-controller':{condition:'service_healthy'}}},
  gateway:{...security,image:'caddy:2.11.7-alpine',command,configs,ports:['80:80/tcp','443:443/tcp'],volumes:['gateway-data:/data','gateway-config:/config'],labels:labels('host-gateway'),depends_on:{'host-agent':{condition:'service_healthy'}}},
 },configs:definition,networks:{management:{labels:labels('host-network')}},volumes:Object.fromEntries([['fleet-state','state'],['fleet-library','library'],['fleet-web','web'],['gateway-data','https-data'],['gateway-config','https-config']].map(([key,suffix])=>[key,{name:project+'-'+suffix,labels:labels('host-storage')}]))};
 if(persistent){delete compose.services.gateway;delete compose.configs;delete compose.volumes['gateway-data'];delete compose.volumes['gateway-config'];compose.services['host-agent'].ports=[String(options.port)+':8080/tcp'];}
 return compose;
}
