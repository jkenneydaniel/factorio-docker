import fs from 'node:fs/promises';
import {X509Certificate} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute=promisify(execFile);
// Local checks only: setup has no network or Docker socket. Check before writing
// accounts/world configuration so an incomplete image cannot report success.
export async function verifyUpdaterRuntime({readFile=fs.readFile,run=execute}={}){
  let certificates;
  try{
    const pem=await readFile('/etc/ssl/certs/ca-certificates.crt','utf8');
    certificates=pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)||[];
    if(!certificates.length)throw Error('Empty CA bundle');
    for(const certificate of certificates)new X509Certificate(certificate);
  }catch{throw Error('The panel image is missing a valid trusted certificate bundle required for updates. Rebuild the image from the current release, then rerun setup.');}
  for(const [name,args] of [['Docker',['--version']],['Docker Compose',['compose','version']],['Docker Buildx',['buildx','version']]]){
    try{
      const result=await run('docker',args,{timeout:5000,maxBuffer:1024*1024,env:{...process.env,DOCKER_CONFIG:'/tmp/factory-control-docker'}});
      if(!result.stdout?.trim())throw Error('No version response');
    }catch{throw Error(`The panel image cannot run ${name}, which is required for updates. Rebuild the image from the current release, then rerun setup.`);}
  }
  return {certificates:certificates.length,tools:['Docker','Docker Compose','Docker Buildx']};
}
