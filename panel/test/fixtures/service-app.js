import fs from 'node:fs/promises';
import path from 'node:path';
import definition from './service-app-definition.json' with {type:'json'};
import {createServiceApplication} from '../../core/service-application.js';
import {zipEntries} from '../../core/archive.js';
import {assert,writeJSON} from '../../common.js';
import {definitionFingerprint} from '../../core/application-services.js';
import {validateEnvironmentBindings,renderEnvironment} from '../../core/environment-bindings.js';

export async function serviceApp(root,{installed=true,secret='fixture-private-application-key'}={}){
  root=await fs.realpath(root);
  const config={container:'synthetic-no-host',state:path.join(root,'state'),library:path.join(root,'library'),backupDir:path.join(root,'backups'),data:path.join(root,'data')};
  for(const directory of Object.values(config).filter(value=>value.startsWith(root)))await fs.mkdir(directory,{recursive:true});
  await writeJSON(path.join(config.state,'application-definition.json'),{id:definition.id,revision:definition.revision,sha256:definitionFingerprint(definition)});
  await fs.writeFile(path.join(config.data,'payload.txt'),'Disposable application storage sentinel.');
  const states=Object.fromEntries(definition.services.map(service=>[service.id,{running:false,ready:false}])),events=[],applied={},environments={},storage={},deploymentEvents=[];
  const deploymentFile=path.join(config.data,'.deployment-provider.json'),deploymentModes={};
  try{await fs.writeFile(deploymentFile,JSON.stringify({initialize:installed?'complete':'absent',cache:installed?'complete':'absent',migrate:installed?'complete':'absent'}),{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
  const deploymentStates=async()=>JSON.parse(await fs.readFile(deploymentFile,'utf8'));
  const setDeploymentState=async(task,state)=>writeJSON(deploymentFile,{...await deploymentStates(),[task]:state});
  const imagePolicy={version:1,defaultImage:'registry.example/service:1',referencePattern:'^registry\\.example/service:1$',architecture:'amd64',labels:{'io.lobby-goblin.fixture':'1'},captureLabels:{}};
  const deploymentTasks=Object.fromEntries(['initialize','cache','migrate'].map(task=>[task,{
    inspect:async()=>(await deploymentStates())[task],
    run:async context=>{
      assert(context.secrets.appKey===secret,'Deployment task requires its scoped secret.');deploymentEvents.push(task);
      if(deploymentModes[task]==='unknown'){await setDeploymentState(task,'unknown');throw Error('Unconfirmed response '+secret);}
      if(deploymentModes[task]==='absent')throw Error('No work submitted '+secret);
      await setDeploymentState(task,'complete');
      if(deploymentModes[task]==='lost-response')throw Error('Response was lost '+secret);
    },
  }]));
  const profiles={'synthetic-process':{roles:['web','worker','scheduler'],imagePolicy,deploymentTasks,
    validate(value,service){
      assert(value?.version===1&&Object.keys(value).every(key=>['version','storage','environment'].includes(key)),'Unsupported synthetic process profile.');
      assert(value.storage&&Object.keys(value.storage).every(key=>['shared','private'].includes(key))&&['shared','private'].every(key=>Array.isArray(value.storage[key])&&value.storage[key].every(name=>/^[a-z][a-z0-9-]{0,31}$/.test(name))),'Synthetic storage needs scoped names, not host paths.');
      validateEnvironmentBindings(value.environment,{secrets:service.secretRefs});
    },
    create:async(_ctx,service,{secrets})=>{
      storage[service.id]={shared:Object.fromEntries(service.configuration.storage.shared.map(name=>[name,path.join(config.data,'shared',name)])),private:Object.fromEntries(service.configuration.storage.private.map(name=>[name,path.join(config.data,'services',service.id,name)]))};
      return {
        inspect:async()=>structuredClone(states[service.id]),
        start:async values=>{events.push('start:'+service.id);applied[service.id]=structuredClone(values);environments[service.id]=renderEnvironment(service.configuration.environment,values,secrets);states[service.id]={running:true,ready:true};},
        stop:async()=>{events.push('stop:'+service.id);states[service.id]={running:false,ready:false};},
        logs:async()=>`Synthetic ${service.role}: ${states[service.id].ready?'ready':'stopped'}\nConfiguration: ${applied[service.id]?.applicationName||'none'} / concurrency ${applied[service.id]?.concurrency??'none'}\nObserved application key: ${secret}`,
      };
    },
  }};
  const module=createServiceApplication(structuredClone(definition),{configuration:()=>config,profiles,secretProviders:{'fixture-key':async()=>secret},backup:{
    files:async()=>[{name:'data/payload.txt',data:await fs.readFile(path.join(config.data,'payload.txt'))}],
    validate:buffer=>{const files=zipEntries(buffer);assert(files.length===1&&files[0].name==='data/payload.txt','Unexpected synthetic application archive.');return {files:files.length};},
  }});
  return {module,config,states,events,applied,environments,storage,deploymentEvents,deploymentStates,setDeploymentState,deploymentModes,profiles,secret};
}
