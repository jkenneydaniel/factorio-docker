// Host operations and resource samples are independent of game commands/formats.
export function createHost({docker,container,stopTimeout=120}){
  let previousCpu=null;
  const info=()=>docker('GET',`/containers/${encodeURIComponent(container)}/json`);
  const control=action=>docker('POST',`/containers/${encodeURIComponent(container)}/${action}${action==='stop'||action==='restart'?'?t='+stopTimeout:''}`);
  async function metrics(running){
    let cpu=null,memory=null;
    try{if(running){
      const stats=await docker('GET',`/containers/${encodeURIComponent(container)}/stats?stream=false&one-shot=true`);
      const sample={total:stats.cpu_stats?.cpu_usage?.total_usage,system:stats.cpu_stats?.system_cpu_usage};
      const prior=stats.precpu_stats?.system_cpu_usage?{total:stats.precpu_stats.cpu_usage.total_usage,system:stats.precpu_stats.system_cpu_usage}:previousCpu;
      const total=prior?sample.total-prior.total:0,system=prior?sample.system-prior.system:0;
      cpu=system>0?Math.max(0,total/system*(stats.cpu_stats.online_cpus||1)*100):null;previousCpu=sample;memory=stats.memory_stats?.usage||null;
    }}catch{}
    return {cpu,memory};
  }
  return {info,control,metrics};
}
