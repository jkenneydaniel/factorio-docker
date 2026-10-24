import {action,backupActions} from '../core/game-contract.js';

export function fixtureContract(actions=[],routes={}){
  return {version:1,features:{backups:true},backup:{strategy:'files',extension:'.zip',mediaType:'application/zip',interruption:false},
    actions:{...backupActions(),...Object.fromEntries(actions.map(name=>[name,action(name)]))},routes};
}

// Terminal job state can be visible while its final persistence still holds the
// controller's operation lock. Sequential integration actions must await idle.
export async function waitForIdleJob(readJobs,id,{attempts=100,pause=()=>new Promise(resolve=>setTimeout(resolve,30))}={}){
  for(let attempt=0;attempt<attempts;attempt++){
    const {jobs,active}=await readJobs();
    const result=jobs.find(job=>job.id===id);
    if(result&&!['queued','running'].includes(result.state)&&!active)return result;
    await pause();
  }
  throw new Error('Job did not finish and release the controller operation lock.');
}

export function settingsTar(settings){
  const body=Buffer.from(JSON.stringify(settings)),header=Buffer.alloc(512);
  header.write('map-settings.example.json');header.write(body.length.toString(8).padStart(11,'0')+'\0',124);
  return Buffer.concat([header,body,Buffer.alloc((512-body.length%512)%512+1024)]);
}
