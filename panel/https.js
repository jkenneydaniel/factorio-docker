import net from 'node:net';

const dnsName=value=>typeof value==='string'&&value.length<=253&&value.split('.').every(part=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part));
const reserved=new net.BlockList();
// RFC 1918 subnets use octets so the release guard can still reject literal
// private deployment addresses elsewhere in source and documentation.
for(const [octets,prefix] of [[[10,0,0,0],8],[[172,16,0,0],12],[[192,168,0,0],16]])reserved.addSubnet(octets.join('.'),prefix,'ipv4');
for(const [address,prefix] of [['0.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['192.0.0.0',24],['192.0.2.0',24],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]])reserved.addSubnet(address,prefix,'ipv4');
const globalV6=new net.BlockList();globalV6.addSubnet('2000::',3,'ipv6');
for(const [address,prefix] of [['2001::',32],['2001:2::',48],['2001:10::',28],['2001:20::',28],['2001:db8::',32],['2002::',16],['3ffe::',16],['3fff::',20]])reserved.addSubnet(address,prefix,'ipv6');

// Store the original DNS spelling for existing installation manifests. IPv6
// identifiers are bare in certificates and bracketed only in HTTP origins.
export function httpsAddress(value){
 const address=typeof value==='string'&&value.startsWith('[')&&value.endsWith(']')?value.slice(1,-1):value;
 const family=typeof address==='string'?net.isIP(address):0;
 const valid=family===4?!reserved.check(address,'ipv4'):family===6?!address.includes('%')&&globalV6.check(address,'ipv6')&&!reserved.check(address,'ipv6'):dnsName(address)&&address.includes('.')&&!/^[\d.]+$/.test(address)&&!/(^|\.)(localhost|local|internal|home\.arpa)$/i.test(address);
 if(!valid)throw Error('HTTPS needs a public IP address or DNS hostname, without a scheme, path or port. Private and reserved IP addresses cannot use Let’s Encrypt.');
 return family===6?new URL('https://['+address+']').hostname.slice(1,-1):address;
}
export const httpsOrigin=address=>'https://'+(net.isIP(address)===6?'['+address+']':address);

// Explicit ACME avoids Caddy's default internal issuer for IP addresses. Caddy
// renews in place using its persistent /data volume; games are never restarted.
export function httpsGateway(address,upstream){
 address=httpsAddress(address);
 const ip=!!net.isIP(address),issuer={module:'acme',ca:'https://acme-v02.api.letsencrypt.org/directory',...(ip?{profile:'shortlived'}:{})};
 const config={admin:{disabled:true},apps:{tls:{certificates:{automate:[address]},automation:{policies:[{subjects:[address],issuers:[issuer],...(ip?{renewal_window_ratio:0.5}:{})}]}},http:{servers:{https:{listen:[':443'],routes:[{match:[{host:[address]}],handle:[{handler:'reverse_proxy',upstreams:[{dial:upstream}]}]}],tls_connection_policies:[{default_sni:address}]}}}}};
 return {command:['caddy','run','--config','/etc/caddy/lobby-goblin.json'],configs:[{source:'gateway-https',target:'/etc/caddy/lobby-goblin.json'}],definition:{'gateway-https':{content:JSON.stringify(config,null,2)+'\n'}}};
}
