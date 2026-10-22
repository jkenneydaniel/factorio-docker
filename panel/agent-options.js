import net from 'node:net';
import {optionsFor} from './install.js';
import {assert} from './common.js';

export const DEFAULT_AGENT_PORT=24443;
export function agentOptionsFor(input={},version){
 let domain=input.agentHost??input.domain;
 assert(typeof domain==='string','Enter the agent IP address or hostname.');domain=domain.replace(/^\[|\]$/g,'').toLowerCase();
 assert(net.isIP(domain)||domain.length<=253&&domain.split('.').every(part=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)),'Use an agent IP address or hostname without a scheme, path or port.');
 if(net.isIP(domain)===6)domain=new URL('https://['+domain+']').hostname.slice(1,-1);
 const port=Number(input.agentPort??input.port??DEFAULT_AGENT_PORT);
 const base=optionsFor({mode:'local',address:input.address??domain,port,memory:input.memory??16,image:input.image},version);
 return {mode:'hosted',address:base.address,domain,port,memory:base.memory,image:base.image,origin:'https://'+(net.isIP(domain)===6?'['+domain+']':domain)+':'+port,transport:'persistent'};
}
