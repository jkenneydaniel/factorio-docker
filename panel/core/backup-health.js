export function summarizeBackups(items,schedule,jobs,storage){
  const latest=items[0]||null,verified=items.filter(item=>item.validation?.ok===true).sort((a,b)=>b.validation.checked.localeCompare(a.validation.checked))[0]||null;
  const lastJob=jobs.find(item=>item.action==='backup'&&!['running','queued'].includes(item.state));
  const alerts=[];
  if(!latest)alerts.push('No backups exist yet.');
  else if(Date.now()-new Date(latest.modified).getTime()>(schedule.enabled?schedule.hours*2:48)*3600000)alerts.push('The latest backup is older than expected.');
  if(lastJob?.state==='failed')alerts.push('The latest backup attempt failed: '+lastJob.message);
  if(items.some(item=>item.validation?.ok===false))alerts.push('A backup failed its integrity check.');
  if(storage&&storage.freeBytes<1024**3)alerts.push('Less than 1 GB of storage is available.');
  return {count:items.length,totalBytes:items.reduce((sum,item)=>sum+item.size,0),latestAt:latest?.modified||null,lastVerifiedAt:verified?.validation.checked||null,verifiedCount:items.filter(item=>item.validation?.ok).length,lastAttempt:lastJob?{state:lastJob.state,finished:lastJob.finished,message:lastJob.message}:null,nextScheduledAt:schedule.enabled&&schedule.lastRun?new Date(new Date(schedule.lastRun).getTime()+schedule.hours*3600000).toISOString():null,storage,alerts};
}
